import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { GudError } from './git.ts'

// An outer sandbox for agents whose own sandbox can't be relied on: the agent
// and every command it runs see the filesystem read-only, with the home
// directory and the user's runtime directory (agent sockets such as
// ssh-agent's) replaced by empty ones, and a fresh /tmp. Writes reach the
// real filesystem only in the workspace and the `rw` paths (the agent's own
// state, such as its login). The network stays open: the agent needs it to
// reach its model, and the commands it runs share it.
export type Binds = { ro: string[]; rw: string[] }

const PASS_ENV = ['PATH', 'LANG', 'LC_ALL', 'TERM', 'USER', 'LOGNAME', 'TZ']

export function bwrapArgs(work: string, binds: Binds, env: Record<string, string> = {}): string[] {
  const home = homedir()
  const runtime = `/run/user/${process.getuid?.()}`
  const vars = { ...Object.fromEntries(PASS_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]!])), HOME: home, ...env }
  return [
    '--die-with-parent', '--new-session', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try',
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--tmpfs', home,
    ...(existsSync(runtime) ? ['--tmpfs', runtime] : []),
    ...binds.ro.filter(existsSync).flatMap((p) => ['--ro-bind', p, p]),
    ...binds.rw.filter(existsSync).flatMap((p) => ['--bind', p, p]),
    '--bind', work, work, '--chdir', work,
    '--clearenv', ...Object.entries(vars).flatMap(([k, v]) => ['--setenv', k, v]),
  ]
}

// Checks that the sandbox confines what it should before an agent runs in
// it: the home directory shows nothing but the binds, writes outside the
// workspace fail, the workspace is writable, and no agent socket leaks in
// through the environment.
export function probe(work: string, binds: Binds): void {
  const home = homedir()
  // The only home entries the agent may see: the top of each bind under home.
  const allowed = [...new Set([...binds.ro, ...binds.rw].map((b) => relative(home, b))
    .filter((r) => r && !r.startsWith('..') && !isAbsolute(r)).map((r) => r.split(sep)[0]))]
  const outside = join('/var/tmp', `.git-gud-probe-${process.pid}`)
  // Paths go in through the environment, so no quoting is needed.
  const checks = [
    'ls -A "$HOME" | grep -vxF -e "$ALLOWED" | sed "s/^/visible in home: /"',
    'if touch "$OUTSIDE" 2>/dev/null; then echo "wrote outside the workspace: $OUTSIDE"; fi',
    'touch "$WORK/.git-gud-probe" 2>/dev/null && rm "$WORK/.git-gud-probe" || echo "workspace not writable"',
    'if [ -n "${SSH_AUTH_SOCK:-}${GPG_AGENT_INFO:-}" ]; then echo "agent socket in environment"; fi',
  ].join('\n')
  // grep -e "" would match everything, so an empty list gets a name no entry has.
  const env = { ALLOWED: allowed.join('\n') || '/', OUTSIDE: outside, WORK: work }
  const r = spawnSync('bwrap', [...bwrapArgs(work, binds, env), 'sh', '-c', checks], { encoding: 'utf8' })
  if (existsSync(outside)) spawnSync('rm', ['-f', outside])
  if (r.error) throw new GudError(`the sandbox needs bubblewrap (bwrap): ${r.error.message}`)
  const problems = (r.stdout + r.stderr).trim()
  if (r.status !== 0 || problems) throw new GudError(`sandbox probe failed, refusing to run the agent: ${problems || `bwrap exited ${r.status}`}`)
}

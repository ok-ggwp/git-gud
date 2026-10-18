import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { GudError } from './git.ts'
import { bwrapArgs, hostSockets, probe, runtimeDir, type Binds } from './sandbox.ts'
import type { Workspace } from './workspace.ts'

export type RunSpec = {
  cmd: string
  args: string[]
  // The agent's outer sandbox, probed before the run; null when the agent
  // confines itself (Claude Code's own sandbox).
  sandbox: Binds | null
  // Where the agent writes its final message, if not to stdout.
  outputFile?: string
}

// What a review may use beyond the workspace. `network`: open outbound
// network for the agent's commands (Codex and Cursor always have it, since
// they reach their model through the sandbox); `domains`: just these, for
// Claude; `browser`: what a headless browser and a local dev server need.
export type Access = { network: boolean; domains: string[]; browser: boolean }
export const NO_ACCESS: Access = { network: false, domains: [], browser: false }

export type Agent = {
  name: string
  // For the reviewer's prompt: what it can and can't do.
  confinement: (ws: Workspace, access: Access) => string
  // One line for `git gud agents`.
  summary: string
  command: string
  login: (bin: string) => string
  spec: (bin: string, ws: Workspace, model?: string, access?: Access) => RunSpec
}

export function which(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const p = join(dir, cmd)
    try { accessSync(p, constants.X_OK); return p } catch { /* next */ }
  }
  return null
}

const firstLine = (r: ReturnType<typeof spawnSync>) =>
  r.error ? `unknown (${r.error.message})` : (`${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0] || `exit ${r.status}`)

// What to tell the reviewer about the network and the browser.
const OPEN_NETWORK = 'You have network access; use it when it helps (installing a missing package, reading documentation), but do not change anything outside the sandbox, such as remote services or repositories.'
const networkText = (access: Access) =>
  access.network ? OPEN_NETWORK
  : access.domains.length ? `Your commands can reach only these domains: ${access.domains.join(', ')}.`
  : 'You have no network.'
const browserText = (access: Access) => access.browser
  ? ' A headless browser is available (`chromium --headless=new --no-sandbox`). For changes that affect a web page, start the project\'s dev server, load the affected pages, take screenshots (--screenshot=<file>, --window-size=<w>,<h>) and look at them, and check the browser console for errors. Start the server and run the browser in one script (write it to a file and run it with bash: start the server in the background, wait for it, run chromium, then kill the server): each shell command may get its own loopback network, so a server started by one command can be unreachable from the next.'
  : ''

const claude: Agent = {
  name: 'claude',
  command: 'claude',
  summary: 'Claude Code in its own OS sandbox: shell commands write only in the workspace, cannot read your home directory, and have no network; file tools are limited to the workspace',
  confinement: (ws, access) => `Your shell commands run in an OS sandbox: you can write only under ${ws.dir} and cannot read the user's home directory. ${networkText(access)}${browserText(access)}`,
  login: (bin) => {
    const r = spawnSync(bin, ['auth', 'status'], { encoding: 'utf8', timeout: 20_000 })
    try { return JSON.parse(r.stdout).loggedIn ? 'logged in' : 'not logged in' } catch { return firstLine(r) }
  },
  spec: (bin, ws, model, access = NO_ACCESS) => {
    // Permission rules take //path for absolute paths, which `/${dir}` gives.
    // The runtime directory and every listening socket are hidden as well as
    // ~: with Unix sockets allowed (a browser needs them), a compositor's,
    // D-Bus's or an X server's socket would let a command run anything
    // outside. Hiding a socket file this way was checked live.
    // The sandbox's network allowlist takes WebFetch(domain:…) rules too;
    // "*" is the documented way to open it fully.
    const settings = {
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        autoAllowBashIfSandboxed: true,
        filesystem: { denyRead: ['~/', runtimeDir(), ...hostSockets(ws.dir)], allowRead: [ws.dir], allowWrite: [ws.dir] },
        network: {
          ...(access.domains.length ? { allowedDomains: access.domains } : {}),
          ...(access.browser ? { allowAllUnixSockets: true } : {}),
        },
      },
      permissions: {
        allow: [`Read(/${ws.dir}/**)`, `Edit(/${ws.dir}/**)`, ...(access.network ? ['WebFetch(domain:*)', 'WebSearch'] : [])],
        deny: ['Read(~/**)', 'Edit(~/**)', ...(access.network ? [] : ['WebFetch', 'WebSearch'])],
      },
    }
    // Only user settings load, so the reviewed repo can't configure its reviewer.
    return { cmd: bin, args: ['-p', '--setting-sources', 'user', '--settings', JSON.stringify(settings), ...(model ? ['--model', model] : [])], sandbox: null }
  },
}

// Codex's and Cursor's own sandboxes are replaced by git-gud's outer one: on
// Linux, Cursor's --sandbox enabled confined nothing in testing (a command
// read ~, wrote /var/tmp and reached the network), and a nested sandbox may
// not start inside the outer one.
const OUTER = 'git-gud\'s bubblewrap sandbox: the agent and its commands see the filesystem read-only, with your home directory hidden except the agent\'s own state; writes reach only the workspace and that state; the network stays open because the agent needs it'

// Codex and Cursor reach their model through the sandbox, so the network is
// open either way; without --network they're asked not to use it.
const outerConfinement = (ws: Workspace, access: Access) =>
  `Your shell commands run in a sandbox: the filesystem is read-only except ${ws.dir}, and the user's home directory is hidden. ` +
  (access.network ? OPEN_NETWORK : 'The network is reachable, but do not use it; nothing in this review needs it.') + browserText(access)

const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex')

const codex: Agent = {
  name: 'codex',
  command: 'codex',
  summary: `Codex in ${OUTER}`,
  confinement: outerConfinement,
  login: (bin) => firstLine(spawnSync(bin, ['login', 'status'], { encoding: 'utf8', timeout: 20_000 })),
  spec: (bin, ws, model) => {
    const real = realpathSync(bin)
    const binds = { ro: [dirname(real)], rw: [codexHome()] }
    const outputFile = join(ws.dir, '.git-gud-last-message.md')
    const env = Object.fromEntries(['CODEX_HOME', 'OPENAI_API_KEY'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]))
    return {
      cmd: 'bwrap',
      args: [...bwrapArgs(ws.dir, binds, env), real, 'exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check',
        '--ephemeral', '--color', 'never', '-C', ws.dir, '-o', outputFile, ...(model ? ['-m', model] : []), '-'],
      sandbox: binds,
      outputFile,
    }
  },
}

const cursor: Agent = {
  name: 'cursor',
  command: 'agent',
  summary: `Cursor's agent CLI in ${OUTER}`,
  confinement: outerConfinement,
  login: (bin) => firstLine(spawnSync(bin, ['status'], { encoding: 'utf8', timeout: 20_000 })),
  spec: (bin, ws, model) => {
    // `agent` is a launcher script that runs the node bundled beside its real path.
    const real = realpathSync(bin)
    const binds = { ro: [dirname(real)], rw: [join(homedir(), '.cursor'), join(homedir(), '.config', 'cursor')] }
    const env: Record<string, string> = process.env.CURSOR_API_KEY ? { CURSOR_API_KEY: process.env.CURSOR_API_KEY } : {}
    return {
      cmd: 'bwrap',
      args: [...bwrapArgs(ws.dir, binds, env), real, '-p', '--trust', '--force', '--sandbox', 'disabled',
        '--workspace', ws.dir, '--output-format', 'text', ...(model ? ['--model', model] : [])],
      sandbox: binds,
    }
  },
}

export const AGENTS: Agent[] = [claude, codex, cursor]

// "claude" or "cursor:gpt-5".
export function parseAgent(s: string): { agent: Agent; model?: string } {
  const [name, ...rest] = s.split(':')
  const agent = AGENTS.find((a) => a.name === name)
  if (!agent) throw new GudError(`unknown agent "${name}" (known: ${AGENTS.map((a) => a.name).join(', ')})`)
  return { agent, model: rest.join(':') || undefined }
}

export function resolveBin(agent: Agent): string {
  const bin = which(agent.command)
  if (!bin) throw new GudError(`${agent.name}: "${agent.command}" is not on PATH`)
  return bin
}

// Runs the agent with the prompt on stdin and returns its final message.
export async function runAgent(spec: RunSpec, ws: Workspace, prompt: string): Promise<{ ok: boolean; output: string; log: string }> {
  if (spec.sandbox) probe(ws.dir, spec.sandbox)
  return new Promise((resolve) => {
    const child = spawn(spec.cmd, spec.args, { cwd: ws.dir, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.stdin.on('error', () => { /* the agent exited early; reported below */ })
    child.stdin.end(prompt)
    child.on('error', (err) => resolve({ ok: false, output: '', log: err.message }))
    child.on('close', (code) => {
      const file = spec.outputFile && existsSync(spec.outputFile) ? readFileSync(spec.outputFile, 'utf8').trim() : ''
      resolve({ ok: code === 0, output: file || stdout.trim(), log: stderr.trim() })
    })
  })
}

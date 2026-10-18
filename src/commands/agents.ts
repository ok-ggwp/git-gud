import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENTS, directArgsConfig, NO_ACCESS, which } from '../agents.ts'
import { GudError } from '../git.ts'
import { probe } from '../sandbox.ts'
import type { Workspace } from '../workspace.ts'

export const usage = 'agents   list the reviewers git-gud can run: installed, logged in, the arguments direct reviews add, and how --sandbox confines each (checked)'

export async function run(): Promise<number> {
  for (const agent of AGENTS) {
    const bin = which(agent.command)
    console.log(`${agent.name}`)
    console.log(`  command:  ${bin ?? `${agent.command} (not on PATH)`}`)
    if (!bin) continue
    console.log(`  login:    ${agent.login(bin)}`)
    const args = directArgsConfig(agent)
    console.log(`  direct:   your own ${agent.name} settings${args ? `, plus ${args} (gud.${agent.name}.args)` : `; add arguments with git config gud.${agent.name}.args`}`)
    console.log(`  sandbox:  ${agent.summary}`)
    // The sandboxes are Linux (and, for Claude, macOS) only.
    if (process.platform === 'win32') continue
    // Probe the outer sandbox with the agent's real binds, in a throwaway workspace.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'git-gud-probe-')))
    try {
      const ws: Workspace = { dir, clone: dir, scratch: dir, removed: [], restored: [], dispose: () => {} }
      const spec = agent.sandboxed(bin, ws, undefined, NO_ACCESS)
      if (spec.sandbox) {
        try { probe(dir, spec.sandbox); console.log('  probe:    ok') } catch (err) {
          if (!(err instanceof GudError)) throw err
          console.log(`  probe:    ${err.message}`)
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return 0
}

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENTS, which } from '../agents.ts'
import { GudError } from '../git.ts'
import { probe } from '../sandbox.ts'
import type { Workspace } from '../workspace.ts'

export const usage = 'agents   list the reviewers git-gud can run, whether each is installed and logged in, and how it is sandboxed (checked)'

export async function run(): Promise<number> {
  for (const agent of AGENTS) {
    const bin = which(agent.command)
    console.log(`${agent.name}`)
    console.log(`  command:  ${bin ?? `${agent.command} (not on PATH)`}`)
    if (!bin) continue
    console.log(`  login:    ${agent.login(bin)}`)
    console.log(`  sandbox:  ${agent.summary}`)
    // Probe the outer sandbox with the agent's real binds, in a throwaway workspace.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'git-gud-probe-')))
    try {
      const ws: Workspace = { dir, clone: dir, scratch: dir, removed: [], dispose: () => {} }
      const spec = agent.spec(bin, ws)
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

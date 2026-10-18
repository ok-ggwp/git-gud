import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EMPTY_TREE, git, gitTry, type Target } from './git.ts'

// Files and directories that configure or instruct coding agents, at any
// depth (agents also read nested ones, such as packages/api/AGENTS.md). A
// reviewed change must not be able to configure or instruct its own reviewer.
// A sandboxed review (untrusted code) removes them all from the checkout; a
// direct review keeps the project's own and only undoes the change's edits to
// them, so the reviewer gets the usual instructions (how to run the tests)
// but not ones the change wrote. Either way the change's versions stay
// readable through git show HEAD:<path>.
const AGENT_FILES = new Set([
  'CLAUDE.md', 'CLAUDE.local.md', '.mcp.json', 'AGENTS.md', 'AGENTS.override.md',
  '.cursorrules', '.cursorignore', 'GEMINI.md', 'copilot-instructions.md',
])
const AGENT_DIRS = new Set(['.claude', '.codex', '.cursor', '.gemini'])

// The tracked paths to remove: a file by its name, or the topmost agent
// directory on its path.
export function agentConfig(files: string[]): string[] {
  const found = new Set<string>()
  for (const f of files) {
    const parts = f.split('/')
    const dir = parts.findIndex((p, i) => i < parts.length - 1 && AGENT_DIRS.has(p))
    if (dir >= 0) found.add(parts.slice(0, dir + 1).join('/'))
    else if (AGENT_FILES.has(parts[parts.length - 1])) found.add(f)
  }
  return [...found].sort()
}

const GLOSS_NOTES = ['refs/notes/gloss', 'refs/notes/gloss-wip']

export type Workspace = {
  // The sandbox directory: the agent may write anywhere under it.
  dir: string
  // A disposable clone, checked out (detached) at the reviewed commit.
  clone: string
  // For the reviewer's scratch tests and repositories.
  scratch: string
  // Agent configuration removed from the checkout (sandboxed: all of it;
  // direct: what the change added) and restored to before the change.
  removed: string[]
  restored: string[]
  dispose: () => void
}

// The commit the reviewed change starts from: a range's base, or the target's parent.
function baseOf(target: Target, clone: string): string | null {
  if (target.kind === 'range') return target.base
  return gitTry(['rev-parse', '-q', '--verify', `${target.sha}^1`], { cwd: clone })?.trim() || null
}

// A disposable clone of the repository at `target`. `glosses` decides whether
// the clone gets the glosses: a blind review must not see them. `strip`
// removes all agent configuration (sandboxed reviews); otherwise only the
// change's edits to it are undone.
export function createWorkspace(repo: string, target: Target, glosses: boolean, strip = true): Workspace {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'git-gud-')))
  const dispose = () => rmSync(dir, { recursive: true, force: true })
  try {
    const clone = join(dir, 'repo')
    const scratch = join(dir, 'scratch')
    // An empty repository that receives only what the review needs: pushing
    // the target sends just the history it can reach. A clone would copy every
    // object, including the notes a blind review must not see and later
    // commits that might give a fix away. No templates, so no hooks.
    git(['init', '-q', '--template=', clone])
    const refs = [`${target.sha}:refs/gud/target`]
    if (target.kind === 'range') refs.push(`${target.base}:refs/gud/base`)
    if (glosses) for (const ref of GLOSS_NOTES) if (gitTry(['rev-parse', '-q', '--verify', ref], { cwd: repo })) refs.push(`+${ref}:${ref}`)
    git(['push', '-q', '--no-verify', clone, ...refs], { cwd: repo })
    git(['checkout', '-q', '--detach', target.sha], { cwd: clone })
    git(['reflog', 'expire', '--expire=now', '--all'], { cwd: clone })
    let removed: string[] = []
    const restored: string[] = []
    if (strip) {
      removed = agentConfig(git(['ls-files', '-z'], { cwd: clone }).split('\0').filter(Boolean))
      for (const f of removed) rmSync(join(clone, f), { recursive: true, force: true })
    } else {
      // Against git's empty tree when there's no base, every file counts as added.
      const base = baseOf(target, clone) ?? EMPTY_TREE
      const fields = git(['diff', '--name-status', '-z', '--no-renames', base, target.sha], { cwd: clone }).split('\0').filter(Boolean)
      for (let i = 0; i + 1 < fields.length; i += 2) {
        const [status, f] = [fields[i], fields[i + 1]]
        if (!agentConfig([f]).length) continue
        if (status === 'A') {
          rmSync(join(clone, f), { force: true })
          removed.push(f)
        } else {
          // Written to the working tree only, so the reviewer's git diff shows the restoration.
          mkdirSync(dirname(join(clone, f)), { recursive: true })
          writeFileSync(join(clone, f), execFileSync('git', ['show', `${base}:${f}`], { cwd: clone }))
          restored.push(f)
        }
      }
    }
    // Copy rather than link dependencies, so nothing the reviewer does reaches the real repo.
    if (existsSync(join(repo, 'node_modules'))) cpSync(join(repo, 'node_modules'), join(clone, 'node_modules'), { recursive: true, verbatimSymlinks: true })
    mkdirSync(scratch)
    return { dir, clone, scratch, removed, restored, dispose }
  } catch (err) {
    dispose()
    throw err
  }
}

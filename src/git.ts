import { execFileSync } from 'node:child_process'

// git-gloss keeps its snapshot of uncommitted work here (one per worktree).
export const WIP_REF = 'refs/worktree/gloss/wip'

// Errors whose message is fit to show the user without a stack trace.
export class GudError extends Error {}

export function git(args: string[], opts: { cwd?: string; input?: string } = {}): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      cwd: opts.cwd,
      input: opts.input,
      env: { ...process.env, LC_ALL: 'C' },
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim()
    throw new GudError(stderr || `git ${args.join(' ')} failed`)
  }
}

export function gitTry(args: string[], opts: { cwd?: string } = {}): string | null {
  try {
    return git(args, opts)
  } catch {
    return null
  }
}

// What is being reviewed. `rev` is passed on to git-gloss as given.
export type Target =
  | { kind: 'commit'; rev: string; sha: string }
  | { kind: 'wip'; rev: 'wip'; sha: string }
  | { kind: 'range'; rev: string; base: string; sha: string; commits: string[] }

export function resolveTarget(rev: string): Target {
  if (rev === 'wip') {
    const sha = gitTry(['rev-parse', '--verify', '-q', WIP_REF])?.trim()
    if (!sha) throw new GudError('no snapshot of uncommitted work; run: git gloss hunks wip')
    return { kind: 'wip', rev, sha }
  }
  if (rev.includes('...')) throw new GudError(`"${rev}": use A..B (the commits on B that are not on A), not A...B`)
  if (rev.includes('..')) {
    const [left, right] = rev.split('..')
    const base = git(['rev-parse', '--verify', '--end-of-options', `${left || 'HEAD'}^{commit}`]).trim()
    const sha = git(['rev-parse', '--verify', '--end-of-options', `${right || 'HEAD'}^{commit}`]).trim()
    const commits = git(['rev-list', '--reverse', '--no-merges', `${base}..${sha}`]).split('\n').filter(Boolean)
    if (!commits.length) throw new GudError(`"${rev}" contains no commits`)
    return { kind: 'range', rev, base, sha, commits }
  }
  return { kind: 'commit', rev, sha: git(['rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`]).trim() }
}

// Diffs with options pinned, so the reviewer sees the same diff whatever the
// user's diff configuration.
const DIFF = ['--no-ext-diff', '--no-textconv', '--no-color', '-M', '--src-prefix=a/', '--dst-prefix=b/']

export function targetDiff(t: Target): string {
  if (t.kind === 'range') return git(['diff', ...DIFF, `${t.base}...${t.sha}`])
  // A wip snapshot is a commit on top of HEAD (with no parent before the
  // first commit), so it diffs like one.
  return git(['show', ...DIFF, '--diff-merges=first-parent', '--format=', t.sha])
}

export const commitMessage = (sha: string) => git(['log', '-1', '--format=%B', sha]).trim()

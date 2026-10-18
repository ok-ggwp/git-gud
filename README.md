# git-gud

Have coding agents review a change in a sandbox, where they can run the code and verify what they find. git-gud is the reviewing half of [git-gloss](https://github.com/ok-ggwp/git-gloss): git-gloss records why each part of a change exists, and git-gud asks agents to check the change and that explanation.

```
git gud review [<commit>|<range>|wip]   review HEAD, a branch (main..feature) or uncommitted work
      --stage bugs,honesty,improve      which reviews to run (default: all three)
      --agent <name>[:<model>]          who reviews: claude, codex or cursor (default: claude);
                                        repeat for several, e.g. --agent claude --agent cursor:gpt-5
      --max <n>                         at most n improvement suggestions (default: 5)
      --dry-run                         print each run's setup and prompt; run no agent (none need be installed)
      --keep                            keep the sandbox directories, for inspection
git gud agents                          which reviewers are installed and logged in, how each is sandboxed
```

## Stages

| Stage | Question | Sees the gloss |
|---|---|---|
| `bugs` | Is anything broken? Defects only: wrong behaviour, edge cases, security, races, regressions, tests that don't test what they claim. | **No**, so it forms its own view of what the change should do. It does see the commit message. |
| `honesty` | Does the gloss tell the truth? Does each group do what it says, is its necessity graded fairly, what could be cut? This is `git gloss review`'s prompt. | Yes |
| `improve` | What could be simpler, reused or faster? Ranked and capped, so it stays short. | Yes, when there is one |

The split comes from a small experiment (five commits with 20 known defects, reviewed with and without their gloss): showing a reviewer the gloss didn't help it find bugs and seemed to anchor it on the author's framing, while the gloss is what makes claim-versus-code mismatches and over-building visible. So bug-hunting runs blind, and the gloss is used where it helps. Reviewer diversity mattered more than the gloss, so several agents can review the same change.

`honesty` needs a gloss and is skipped without one; `improve` falls back to the commit message and diff. Both need `git gloss` on PATH. `wip` reviews git-gloss's snapshot of uncommitted work (`git gloss hunks wip` takes it).

Each run gets its own disposable clone, and the runs go in parallel. Results are printed as markdown, one section per stage and agent; progress goes to stderr:

```sh
git gud review main..feature --agent claude --agent cursor > review.md
```

## Sandboxing

Each reviewer works in a fresh directory holding a new repository that has received only the history of the change under review (and, for a range, of its base), checked out (detached) at the change, with no remote, no hooks and no reflog. Later commits, other branches and, for the bug reviewer, the glosses are not in it: not as refs and not as objects. Agent configuration in the change (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/`, `.codex/`, `.mcp.json`, …), at any depth, is removed from the checkout, so a change can't instruct or configure its own reviewer; the files stay readable through `git show HEAD:<path>`. `node_modules` is copied in, so the reviewer can run the tests.

- **claude** runs in Claude Code's own OS sandbox (bubblewrap on Linux): its shell commands can write only in the sandbox directory, can't read your home directory, and have no network; its file tools are limited to the sandbox directory. Only your user-level Claude Code settings load. The run fails rather than run unsandboxed.
- **codex** and **cursor** run inside git-gud's own bubblewrap sandbox, because their own sandboxes can't be relied on here: on Linux, Cursor's `--sandbox enabled` confined nothing in testing (a command read a file in `~`, wrote to `/var/tmp` and reached the network), and a nested sandbox may not start inside an outer one. The agent and every command it runs see the filesystem read-only; your home directory and `/run/user/<uid>` (ssh-agent and other sockets) are replaced by empty ones, the environment is cleared, and writes reach only the sandbox directory and the agent's own state (`~/.codex`, or `~/.cursor` and `~/.config/cursor`). Before each run git-gud probes the sandbox (home shows nothing but the agent's own state, a write outside fails, the workspace is writable, no agent socket) and refuses to run if any check fails. `git gud agents` runs the same probe.

Not covered:
- **Codex and Cursor reviewers have network access**, because the agent needs it to reach its model and the commands it runs share it. They are asked not to use it. Their login is readable inside the sandbox, so a reviewer misled by the change it reviews could send it out.
- Paths outside your home directory, such as `/etc`, stay readable for all agents.
- Codex is wired up but untested against a live login so far.

## Setup

Requires Node 23.6+ (TypeScript runs directly, no build step), git, and bubblewrap (`bwrap`) for the Codex and Cursor reviewers.

```sh
npm install
npm link        # puts git-gud on PATH, so `git gud` works
npm test
```

# git-gud

Have coding agents review a change in a disposable clone, where they can run the code and verify what they find. git-gud is the reviewing half of [git-gloss](https://github.com/ok-ggwp/git-gloss): git-gloss records why each part of a change exists, and git-gud asks agents to check the change and that explanation.

```
git gud review [<commit>|<range>|wip]   review HEAD, a branch (main..feature) or uncommitted work
      --stage bugs,honesty,improve      which reviews to run (default: all three)
      --agent <name>[:<model>]          who reviews: claude, codex or cursor (default: claude);
                                        repeat for several, e.g. --agent claude --agent cursor:gpt-5
      --max <n>                         at most n improvement suggestions (default: 5)
      --browser | --no-browser          ask reviewers to check web pages in a headless browser (default: gud.browser)
      --sandbox | --no-sandbox          confine reviewers, for code you don't trust (default: gud.sandbox)
      --network | --no-network          ...and let their commands use the network (default: gud.network)
      --allow-domain <domain>           ...or only these domains (Claude), e.g. registry.npmjs.org
      --dry-run                         print each run's setup and prompt; run no agent (none need be installed)
      --keep                            keep the workspace directories, for inspection
git gud agents                          which reviewers are installed and logged in, and how each runs
```

## Stages

| Stage | Question | Sees the gloss |
|---|---|---|
| `bugs` | Is anything broken? Defects only: wrong behaviour, edge cases, security, races, regressions, tests that don't test what they claim. | **No**, so it forms its own view of what the change should do. It does see the commit message. |
| `honesty` | Does the gloss tell the truth? Does each group do what it says, is its necessity graded fairly, what could be cut? This is `git gloss review`'s prompt. | Yes |
| `improve` | What could be simpler, reused or faster? Ranked and capped, so it stays short. | Yes, when there is one |

The split comes from a small experiment (five commits with 20 known defects, reviewed with and without their gloss): showing a reviewer the gloss didn't help it find bugs and seemed to anchor it on the author's framing, while the gloss is what makes claim-versus-code mismatches and over-building visible. So bug-hunting runs blind, and the gloss is used where it helps. Reviewer diversity mattered more than the gloss, so several agents can review the same change.

`honesty` needs a gloss and is skipped without one; `improve` falls back to the commit message and diff. Both use the git-gloss that comes with git-gud. `wip` reviews git-gloss's snapshot of uncommitted work, which `git gloss hunks wip` takes, so that needs git-gloss installed too.

Each run gets its own disposable clone, and the runs go in parallel. Results are printed as markdown, one section per stage and agent; progress goes to stderr:

```sh
git gud review main..feature --agent claude --agent cursor > review.md
```

## How reviewers run

By default a reviewer runs **as it would in your own session**: in its disposable clone, with your normal Claude Code, Codex or Cursor settings, permissions and network. If you already trust your agents to run code on your behalf, the reviewer needn't be more restricted than they are, and it works the same on Linux, macOS and Windows.

A review runs headless, so nobody is there to approve a command your settings would normally ask about; the reviewer is simply refused and can only read the code. Give it the permission mode you use day to day:

```sh
git config --global gud.claude.args "--permission-mode auto"   # or acceptEdits, bypassPermissions, …
git config --global gud.cursor.args "--force"                  # run commands without asking
git config --global gud.codex.args "-s workspace-write"        # or your usual sandbox/approval flags
git config --global gud.browser true                           # check web pages in a headless browser
```

`git gud agents` shows what each agent's direct runs add. With `--browser`, reviewers are asked to start the project's dev server, load the pages a change affects in a headless browser (Chrome, Chromium, or Playwright if the project has it), take screenshots and look at them, and check the console for errors.

What stays the same in every mode:
- **A disposable clone.** Each reviewer works in a fresh repository holding only the reviewed history, so its edits don't land in your working tree, reviewers don't trip over each other, and the bug reviewer's clone has no glosses. In a direct run this is where the reviewer works, not a wall: with your permissions it could still reach your real repository, and is only told not to.
- **The change can't brief its own reviewer.** If the change edited the project's agent configuration (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/`, …, at any depth), those files are put back as they were before the change, and ones it added are removed; the reviewer gets the project's usual instructions, not the change's. The change's versions stay readable through `git show HEAD:<path>`. This covers the agent configuration files themselves, not what they pull in: if the project's `CLAUDE.md` imports another file, or its settings run a hook script or an MCP server from the repository, the change's version of that file is what the reviewer gets.

Each direct review prints a one-line reminder that reviewers run with your own settings and permissions.

## Sandboxed reviews (`--sandbox`)

For code you don't trust (a contributor's branch, a dependency bump), `--sandbox` confines each reviewer, as described below; `git config gud.sandbox true` makes it the default. Sandboxed reviews need Linux, macOS (Claude) or WSL2. In this mode all agent configuration is removed from the checkout, not just the change's edits.

A sandboxed Claude reviewer has no network unless you allow it, and Codex and Cursor reviewers are asked not to use theirs:

```sh
git gud review --sandbox --network                               # open
git gud review --sandbox --allow-domain registry.npmjs.org       # only these domains (Claude)
git config --global gud.network true                             # open by default when sandboxed
```

With `--browser`, a sandboxed Claude reviewer has to start the server and run the browser in one script: on Linux each of its shell commands gets its own loopback network. Chromium has to be installed system-wide; Playwright's own browser downloads live in your (hidden) home directory.

### What the sandbox does

Each reviewer's repository has received only the history of the change under review (and, for a range, of its base), checked out (detached) at the change, with no remote, no hooks and no reflog. Later commits, other branches and, for the bug reviewer, the glosses are not in it: not as refs and not as objects. `node_modules` is copied in, so the reviewer can run the tests.

- **claude** runs in Claude Code's own OS sandbox (bubblewrap on Linux): its shell commands can write only in the sandbox directory and can't read your home directory, your runtime directory (`/run/user/<uid>`) or any Unix socket something is listening on; the network is as set above. Its file tools are limited to the sandbox directory. Only your user-level Claude Code settings load. The run fails rather than run unsandboxed. With the browser on, Unix sockets are allowed (Chromium needs them). Hiding the sockets is what keeps that safe: many run commands for whoever connects (the D-Bus session bus, a compositor's control socket, gpg-agent, an editor's server, an X server in `/tmp/.X11-unix`, tmux), so git-gud hides every listening socket it finds in `/proc/net/unix` when the review starts, wherever it lives. A socket created after that isn't covered. Checked live: with network and browser on, the session bus, Hyprland's socket, Docker's socket and the X server were all unreachable, while the network, Chromium and DNS still worked.
- **codex** and **cursor** run inside git-gud's own bubblewrap sandbox, because their own sandboxes can't be relied on here: on Linux, Cursor's `--sandbox enabled` confined nothing in testing (a command read a file in `~`, wrote to `/var/tmp` and reached the network), and a nested sandbox may not start inside an outer one. The agent and every command it runs see the filesystem read-only; your home directory and `/run/user/<uid>` (ssh-agent and other sockets) are replaced by empty ones, the environment is cleared, and writes reach only the sandbox directory and the agent's own state (`~/.codex`, or `~/.cursor` and `~/.config/cursor`). Every other listening Unix socket (Docker's, systemd's, …) is covered by an empty file. Before each run git-gud probes the sandbox (home shows nothing but the agent's own state, a write outside fails, the workspace is writable, no agent socket in the environment, the runtime directory is empty, no listening socket reachable) and refuses to run if any check fails. `git gud agents` runs the same probe.

Not covered:
- **With the network on, a reviewer can send out anything it can read**: the repository and files outside your home directory. Codex and Cursor reviewers always have the network (the agent reaches its model through it) and are only asked not to use it unless it's on. Their login is readable inside the sandbox.
- **Abstract Unix sockets** (names, not files) can't be hidden by covering directories. Claude's sandbox has its own network namespace, which isolates them; Codex and Cursor share yours, so on a desktop with an abstract X11 socket a reviewer could reach the X server. There are none on the machine this was tested on.
- Paths outside your home directory, such as `/etc`, stay readable for all agents.
- Codex is wired up but untested against a live login so far.

## Setup

Requires Node 20.16+, git, and the agent CLIs you want to review with (`claude`, `codex`, `agent`). Sandboxed reviews also need Linux, macOS (Claude) or WSL2, and bubblewrap (`bwrap`) for the Codex and Cursor reviewers.

```sh
npm install -g @ok-ggwp/git-gloss @ok-ggwp/git-gud
git config --global gud.claude.args "--permission-mode auto"   # see "How reviewers run"
```

git-gud brings its own copy of git-gloss for the honesty and improve stages; install git-gloss globally as well to gloss changes with `git gloss`.

To work on git-gud itself: clone it, `npm install`, `npm link`, `npm test`. From a checkout, on Node 22.18+, the TypeScript source runs directly; on older versions the launcher runs `dist/`, which `npm install` builds (and `npm run build` rebuilds after changes). The tests need Node 23.6+.

## License

MIT. See [LICENSE](LICENSE).

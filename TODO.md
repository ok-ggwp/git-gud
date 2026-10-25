# git-gud: what is still to do

Written 2026-10-25, from the reviews of `--evidence`. Remove an item when it ships.

- [ ] The honesty addendum names git-gloss's honesty items 2 and 3 by number; re-check when git-gloss changes that list (or move the text into git-gloss's own prompt).
- [ ] `--timeout` kills with SIGKILL at once: the agent gets no grace period to flush a partial report.
- [ ] `--timeout`: a SIGKILL of git-gud itself leaves detached reviewers running (no exit handler runs); and the group is signalled by the leader's pid after the leader was reaped, which is safe only while no unrelated process has taken that pid.
- [ ] `--timeout` is not supported on Windows (no process groups); a `taskkill /T` path would fix that.
- [ ] `--timeout`: the group is signalled by the leader's pid also on every timed leader `exit` (`killGroup(pid)` after the leader is gone); the pid-reuse window is tiny but not closed.
- [ ] `--timeout`: output still streaming from an escaped process after the 2 s grace is cut, and the run is reported ok.
- [ ] SIGHUP/SIGQUIT now dispose the workspaces and exit 129/131 for every run, timed or not; the exit codes are untested for untimed runs.
- [ ] `--timeout`: a stuck `ws.dispose()` leaves a detached timed reviewer running until git-gud itself is killed (README should say so).
- [ ] `adversarial` and `mutate` rules (no network, restore with cmp) are prompt instructions only, not enforced (`--sandbox` is the real control, and both stages run repository code); git-gud does not check the clone is restored or that the report's REPRODUCED lines were really run. A post-run `git status` of the clone could flag edits to tracked files.
- [ ] git-gloss's review summaries (`git gloss show`) have no stage-specific wording for `adversarial` and `mutate`; they show the generic verdict phrase.
- [ ] The `@ok-ggwp/git-gloss` dependency in package.json is still `^0.7.0`; raise it to the release that refuses reports without a findings block (0.8.0 or later, owner to confirm), and bump git-gud's own version.
- [ ] The tests that exercise the recording contract need `GIT_GLOSS_BIN` (a git-gloss 0.8+ executable) and skip with a stated reason without it; once the bundled dependency is 0.8+, they can run against it and the variable become optional.
- [ ] Only one repair retry per stage; raw reports saved after a failed retry are never cleaned up by git-gud (they sit in the temp directory).
- [ ] The honesty prompt is git-gloss's; against a git-gloss older than 0.8 git-gud adds the block spec to its addendum, which should go once 0.8 is the minimum.
- [ ] Nothing checks that the block agrees with the prose (the design says the honesty prompt should check they match); measure on real runs how often the retry fires and how often reviewers mark `verified` without having run anything.
- [ ] The retry prompt cuts a very long report in the middle; a reviewer cannot repair prose it no longer sees, only the block.
- [ ] The "retry returned nothing" case is signalled with an ad hoc flag on the error object in review.ts; a small error class would be cleaner.
- [ ] `honestyAddendum` adds the block spec unless the git-gloss honesty prompt contains BLOCK_SPEC exactly; a reworded git-gloss prompt would get the spec twice.
- [ ] The "retry returned nothing" signal is an ad hoc `empty` flag on the error in review.ts.
- [ ] The retry runs in the clone of the first attempt (the prompt tells adversarial and mutate reviewers to check it is clean and restore anything mutated); a fresh clone would remove the doubt.

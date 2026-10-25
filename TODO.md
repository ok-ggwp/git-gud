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

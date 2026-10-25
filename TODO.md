# git-gud: what is still to do

Written 2026-10-25, from the reviews of `--evidence`. Remove an item when it ships.

- [ ] `cleanText` leaves a character after a bare ESC ESC out (`\x1b\x1b[31m` loses the next visible character); cosmetic.
- [ ] The improve prompt asks reviewers to say whether the tests still pass after applying a suggestion; the rules block allows single test files only. Reword.
- [ ] A test for a change whose material contains the separator in the honesty stage (today only bugs and improve are covered).
- [ ] The honesty addendum names git-gloss's honesty items 2 and 3 by number; re-check when git-gloss changes that list (or move the text into git-gloss's own prompt).
- [ ] `--evidence` also reaches the blind bugs stage; consider a per-stage form so lint output (which quotes the gloss) cannot leak into it.
- [ ] The 8-minute budget is only an instruction; `runAgent` has no run timeout.
- [ ] Release 0.3.0 once git-gloss 0.6.0 is published: bump the bundled git-gloss (the README example uses `git gloss lint`).

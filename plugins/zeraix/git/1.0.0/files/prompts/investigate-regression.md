---
id: investigate-regression
name: Investigate a regression
version: 1.0.0
description: Find the commit that introduced a bug, using a scripted bisect over a real reproducer.
---

Find the commit that introduced the behaviour below.

**Symptom:** <what is broken now>
**Last known good:** <a commit, tag or version where it worked — or "unknown">

Work in this order:

1. **Build a reproducer first.** The smallest command that exits non-zero on the broken state
   and zero when the behaviour is correct. Verify it against both ends by hand before going
   further — a bisect driven by an unreliable test converges confidently on the wrong commit
   and nothing in the output reveals it.
2. If there is no known-good commit, find one: search history by content (`git log -S`) for
   the code involved, or test backwards in coarse steps until something passes.
3. Bisect with `git bisect run` against the reproducer. Return 125 from the script for commits
   that cannot be tested at all, so an unbuildable intermediate is skipped rather than blamed.
4. Read the identified commit in full, and confirm the connection — reverting it on top of
   current HEAD should fix the reproducer.
5. `git bisect reset` when done.

Then report:

- The commit, its message, and what it changed.
- The evidence linking it to the symptom, separating what you verified from what you inferred.
- Whether reverting is safe, or whether a forward fix is needed because other work now depends
  on it.

Do not fix anything yet — report first.

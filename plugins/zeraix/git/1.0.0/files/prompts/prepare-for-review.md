---
id: prepare-for-review
name: Prepare a branch for review
version: 1.0.0
description: Get the current branch into a state a reviewer can actually read — coherent commits, current with its base, no stray files.
---

Get this branch ready for review.

**Base branch:** <main, or whatever this will merge into>

Assess first, and report before changing anything:

1. What is on the branch — `git log --oneline <base>..HEAD` and the overall diffstat.
2. Whether the branch is pushed, and whether a pull request already exists. This decides
   whether history may be rewritten at all.
3. Whether the working tree is clean, and whether anything staged or untracked does not belong
   (debug output, scratch files, local config).
4. How far behind the base it is, and whether it merges cleanly.

Then propose — do not execute yet — a plan covering:

- **Commits.** Fixup commits squashed into what they fix, messages that describe the change,
  mechanical changes separated from behavioural ones. Say which commits you would combine and
  which you would leave alone.
- **Base.** Rebase or merge, with the reason. If the branch is shared, it is merge.
- **Cleanup.** Files that should not be committed, and anything that belongs in `.gitignore`.

Ask before rewriting any commit that has been pushed, and before force-pushing at all. If the
branch is genuinely private and unpushed, proceed with the cleanup once the plan is agreed.

Finish by confirming the branch still builds and its tests still pass — a tidy history that
does not compile is worse than the messy one it replaced.

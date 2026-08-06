---
id: fix-issue
name: Fix an issue
version: 1.0.0
description: Take an issue, branch, fix it, verify it, and open a pull request that closes it.
---

Fix the issue below, end to end.

**Issue:** <number, URL, or a description to search for>

Work in this order, and stop at the gate before the last step.

1. **Find and read it.** If given a description rather than a number, search the remote's
   issues — including closed ones, since a closed match is either a duplicate or a regression.
   Read the issue in full: reproduction, expected behaviour, and any maintainer comment that
   rules an approach in or out.
2. **Report back what you found** before writing code: the issue, what it actually asks for,
   your reading of the cause, and the approach you intend. If the issue is ambiguous or the
   reporter's expectation looks wrong, that is the moment to say so.
3. **Branch.** Check the current branch first; if it is the base branch, create a new one from
   an up-to-date base and follow the repository's naming convention.
4. **Reproduce, then fix.** A failing test first where the project has tests. Keep the branch
   to this issue — note adjacent problems separately rather than absorbing them.
5. **Verify.** Run the reproduction, the tests, the linter and the build — everything CI will
   run.
6. **Commit** in coherent pieces, referencing the issue.
7. **Open the pull request** — after confirming with me. Link the issue with a closing keyword,
   describe what and why, say how it was verified, and say what you deliberately left.

Then report what you built, what you verified, and what you could not.

Do not merge. Tell me when it is ready and I will decide.

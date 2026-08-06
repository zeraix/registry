---
id: git-collaboration
name: Sharing work safely
version: 1.0.0
author: zeraix
audience: dev
scope: targeted
tags: [git, remotes, force-push, collaboration]
description: Remotes, force-push safety, and the rules for rewriting history someone else may already hold. Load this before any force push, before rewriting pushed commits, and when a push is rejected as non-fast-forward.
allowedTools: [run_command, read_file]
---

# Sharing work safely

Everything local is reversible. Once commits reach a remote, mistakes become other people's
problem, and the reflog that saves you locally does not exist on their machine.

## The only question that matters before rewriting

**Does anyone else have these commits?**

If no: rewrite freely. Rebase, amend, squash, reorder.

If yes: do not rewrite. Add a commit instead. `git revert` undoes a change by making a new
commit that reverses it — history grows rather than changing shape, and nobody's clone
diverges.

If unsure: assume yes. The cost of an unnecessary revert commit is one line of noise. The cost
of rewriting shared history is every collaborator resolving a divergence they did not cause
and cannot easily diagnose.

**Deciding whether a branch is private** is the part that actually goes wrong. It is not
private merely because you created it. Check whether it is pushed (`git branch -vv` shows the
tracking branch and divergence), whether a pull request exists, whether CI or a preview
deployment is building from it, and whether anyone has been asked to look at it. Any of those
is a real answer to "does someone have this".

## Force pushing

When a rewrite of pushed commits is genuinely necessary — a squash before merge on a branch
that is only yours, a removed secret — use `--force-with-lease`, never `--force`.

`--force-with-lease` refuses the push if the remote branch moved since you last fetched. That
is exactly the case where forcing would destroy someone's work, and plain `--force` overwrites
it without a word. There is no situation where `--force` is right and `--force-with-lease` is
not; the second is simply the first with the check that makes it safe.

Fetch first. A stale local view makes the lease check pass against information old enough to
be wrong.

Never force-push a shared branch — `main`, `develop`, a release branch — regardless of the
flag. If something must be removed from one, that is a coordinated operation with the people
who work on it, not a command.

## When a push is rejected

A non-fast-forward rejection means the remote has commits you do not. That is information, not
an obstacle: something happened that you do not know about yet.

Fetch and look before deciding — `git log HEAD..@{u}` shows what they have that you do not,
and `git log @{u}..HEAD` the reverse. Then integrate: rebase if your commits are unpushed and
private, merge otherwise.

Reaching for `--force` to clear a rejection is how other people's commits disappear. The
rejection exists precisely to prevent that.

## Pulling

`git pull` merges by default, creating merge commits for routine updates. Many projects prefer
`--rebase` for a linear history; check what the repository already does — `git log --graph`
answers it in a second — rather than imposing a style.

`git pull` with dirty local changes fails partway or produces a conflicted state. Commit or
stash first.

## Removing something sensitive

A secret in a pushed commit is not fixed by a follow-up commit that deletes it — it stays in
history, and in every clone.

Treat the credential as compromised and rotate it. That is the actual fix, and it is the only
step that is fully within your control. Purging history afterwards is a separate, coordinated
operation requiring every collaborator to re-clone; rotating first means the purge is cleanup
rather than an emergency.

## Acting on a repository for someone else

Push, force-push, tag and branch deletion are outward-facing: they change what other people
see, and some of them are not reversible from here.

Do them only when asked, and confirm before anything with a blast radius beyond a private
branch. Approval to push once is not standing approval to force-push later. When something
seems clearly needed but was not requested, say so and let the user decide — the information
that makes it the right call is often information they have and you do not.

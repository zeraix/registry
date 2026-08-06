---
id: git-recovery
name: Recovering lost work
version: 1.0.0
author: zeraix
audience: dev
scope: targeted
tags: [git, reflog, reset, recovery, undo]
description: What is recoverable after a bad Git command and what is genuinely gone. Load this before running anything destructive, and immediately when work appears to have been lost — reflog, the three reset modes, dangling commits, and the short list of operations that actually destroy data.
allowedTools: [run_command, read_file]
---

# Recovering lost work

Almost everything committed is recoverable. Almost nothing uncommitted is. That single
distinction governs every decision here.

## Before doing anything destructive

Commit first. A commit — even a bad one, even on a scratch branch — puts the work inside the
recoverable set. `git stash` also works but is easier to lose track of, since stashes do not
appear in `git log` or `git status` and are trivially forgotten across sessions.

The operations worth pausing before:

- `git reset --hard` — discards uncommitted changes, unrecoverably.
- `git checkout -- <file>` / `git restore <file>` — same, for one file.
- `git clean -fd` — deletes untracked files. Not in Git at all, so not in the reflog. Run
  `git clean -nd` first to see the list.
- `git rebase`, `git commit --amend`, `git reset` — rewrite history, but the originals survive
  in the reflog.
- `git push --force` — see the sharing skill; this one destroys work on the *remote*.

## The reflog

The reflog records every position HEAD has held — commits, checkouts, resets, rebases,
merges — for about 90 days by default. It is the recovery tool, and it works even when the
commits are no longer reachable from any branch.

`git reflog` lists recent positions with a reason for each. Find the entry from before the
mistake and either inspect it (`git show HEAD@{5}`) or return to it
(`git reset --hard HEAD@{5}`). Branches have their own reflogs too: `git reflog show <branch>`.

The critical property: **a hard reset after a bad rebase does not lose the rebase's input.**
The pre-rebase commits are still there, still in the reflog, until they are garbage collected.
This is why "I rebased and lost everything" is nearly always false.

`ORIG_HEAD` is a shortcut — Git sets it before merges, rebases and resets, so
`git reset --hard ORIG_HEAD` undoes the last one without reading the reflog.

## The three resets

They differ only in how far the change reaches:

- `--soft` moves the branch pointer; index and working tree untouched. The changes from the
  discarded commits are left staged. Use it to recombine several commits into one.
- `--mixed` (default) moves the pointer and resets the index; working tree untouched. Changes
  are left unstaged. Use it to redo staging.
- `--hard` moves all three. **This is the only one that discards work**, and only work that was
  not committed.

If unsure, use `--soft`. It never loses anything, and the changes are right there staged for
inspection.

## Dangling commits the reflog missed

If a commit is not in the reflog — it was made in a different clone, or the reflog entry
expired — `git fsck --lost-found` lists unreachable objects. It is noisy, but a dangling
commit found there can be inspected with `git show` and recovered by branching from it.

This is genuinely last-resort. Check the reflog first.

## What is actually unrecoverable

Be honest about these rather than searching hopefully:

- Uncommitted changes discarded by `reset --hard`, `restore`, or `checkout --`. Gone. The only
  hope is an editor's local history or an IDE's local-changes feature — worth checking, and
  worth suggesting to the user before they close the editor.
- Untracked files removed by `git clean`. Gone; they were never in Git.
- Stashes dropped with `git stash drop` are *sometimes* recoverable via `fsck`, since the
  commit object survives until garbage collection.
- Anything on a remote after a force-push, unless someone still holds the old commits locally
  or the host keeps a reflog.

## Recovering on someone's behalf

Diagnose before acting. Run `git status`, `git reflog` and `git stash list` and read them
before running anything that writes — a recovery attempt that starts with a reset can destroy
the very thing being recovered.

Say what you are about to do and what it will discard, especially where uncommitted changes
are in play. "This will discard the uncommitted changes in three files" is information the
user may act on; discovering it afterwards is not recoverable.

Where several routes exist, prefer the one that adds rather than removes. Creating a branch at
a recovered commit leaves everything intact and reversible; resetting the current branch to it
does not.

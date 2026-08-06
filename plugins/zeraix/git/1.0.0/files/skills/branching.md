---
id: git-branching
name: Branching, rebasing and conflicts
version: 1.0.0
author: zeraix
audience: dev
scope: targeted
tags: [git, rebase, merge, conflicts, version-control]
description: When to rebase and when to merge, how to bring a branch up to date without rewriting history other people hold, and how to resolve conflicts by reading both sides. Load this before rebasing, before resolving a conflict, or when a branch has drifted far from its base.
allowedTools: [run_command, read_file, edit_file, search_files]
---

# Branching, rebasing and conflicts

## Rebase or merge

The decision is about **who else has the commits**, not about which history looks nicer.

**Rebase** when the branch is yours alone and you want it to read as if written against
current main. It produces a linear history that is genuinely easier to bisect and review.

**Merge** when the branch is shared, when it is long-lived, or when the merge itself is
information worth keeping. A merge commit records that two lines of development joined, and
sometimes that is the fact you want.

**Never rebase commits other people have based work on.** Rebasing rewrites every commit
after the base, so anyone holding the originals now has a divergent copy, and their next pull
produces a merge between two versions of the same work. The cost lands on them, not you,
which is why the rule is stated as absolute rather than as a trade-off.

Bringing a branch up to date is usually the easy case: if nobody else has your branch, rebase
onto the updated base. If they might, merge the base in.

## Rebasing without losing track

Note the starting point before you begin — `git log --oneline -1` or a scratch branch — so
that recovering is a `git reset --hard <sha>` rather than an archaeology exercise. `ORIG_HEAD`
and the reflog also hold it, but knowing the sha up front turns a stressful recovery into a
boring one.

When a rebase goes wrong mid-flight, `git rebase --abort` returns to exactly where you started.
It works right up until the rebase completes, and it is almost always the right move when the
conflicts stop making sense — better to abort, understand the divergence, and start again than
to resolve twenty hunks half-guessing.

If the same conflict keeps reappearing at each commit, the branch is being replayed over a
base that moved underneath it. Consider merging instead, or squashing the branch first so
there is one conflict to resolve rather than one per commit.

## Conflicts

A conflict means both sides changed the same region. Git is not confused — it is telling you
that only a human knows the intent.

**Read both sides before touching anything.** The markers show yours and theirs, but the
labels invert depending on whether you are merging or rebasing, and resolving the wrong way
round is the most common conflict error there is. During a rebase, "ours" is the *base* you
are replaying onto and "theirs" is *your* commit — the opposite of what the words suggest.
Check with `git status`, which names the operation in progress.

**Understand why each side changed it.** `git log -1 <sha>` on the conflicting commits usually
explains it in one line. A conflict between a bug fix and a refactor needs both intents
preserved, and you can only do that once you know what they were.

**Do not resolve by picking a side wholesale** unless you have established that one side is
genuinely obsolete. Taking "theirs" everywhere to clear the conflict silently discards work
someone did deliberately, and it will not show up in review because the diff looks clean.

**Build and test after resolving.** A syntactically valid resolution that drops a needed line
is the standard outcome of resolving quickly, and it is invisible in the diff — the file looks
fine, it simply no longer does what one side intended. This is the step people skip, and it is
the one that matters.

## Interactive rebase

Use it to clean a branch before review: squash fixups into the commits they fix, reword
messages written in a hurry, drop the commit that only added a debug print, reorder so the
refactor precedes the fix.

Two cautions:

- Splitting a commit means editing it, resetting, and committing in pieces. It is slower than
  it looks and easy to abandon halfway through, leaving a rebase in progress.
- Every rewritten commit gets a new sha. If any of them are pushed, read the sharing skill
  before continuing.

## Long-lived branches

A branch that lives for weeks accumulates conflicts faster than it accumulates value. Prefer
merging the base in regularly over one enormous reconciliation at the end — each merge is
small and its conflicts are still fresh in someone's memory.

When a branch has fallen very far behind, consider whether replaying it is even the right
move. Re-implementing a small change against current main is sometimes cheaper and always
easier to review than resolving forty hunks of drift.

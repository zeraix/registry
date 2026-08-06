---
id: git-commits
name: Writing commits
version: 1.0.0
author: zeraix
audience: dev
scope: targeted
tags: [git, commits, review, version-control]
description: How to stage and split work into commits that stay reviewable and bisectable. Load this before committing a change that touches more than one concern, or when a working tree has accumulated several unrelated edits that need separating.
allowedTools: [run_command, read_file, edit_file, search_files]
---

# Writing commits

A commit has two audiences: the reviewer reading it this week, and whoever runs `git bisect`
against it in two years. Both want the same thing — one commit that does one thing, and a
message that says why.

## What belongs in one commit

The test is whether the commit can be described without the word "and", and whether reverting
it would leave the tree working. A commit that renames a function *and* fixes a bug is two
commits: revert it to undo the bug fix and you also undo the rename.

Split by concern, not by file. A change spanning eight files is one commit if it is one idea.
Two changes in one file are two commits.

Keep each commit building. A series where the middle commits do not compile is a series
`bisect` cannot use, which throws away most of the value of having made a series at all.

The common exceptions, both worth honouring:

- **Mechanical changes go alone.** A reformat, a rename across 200 files, a dependency bump.
  Mixed into a behavioural change they hide it completely — the reviewer cannot see three real
  lines among two thousand mechanical ones, so they stop looking.
- **A refactor that enables a fix comes first, separately.** "Extract the validation", then
  "fix the validation". Each is small, and the fix is legible because the setup already landed.

## Staging deliberately

`git add -A` at the end of a session commits whatever happened to be in the tree — debug
prints, a scratch file, an unrelated edit made while reading something else.

Look before staging. `git status` for what is there and `git diff` for what it says. When a
file holds two unrelated changes, stage by hunk (`git add -p`) and split them.

Check the staged result, not the working tree: `git diff --staged` is what is about to become
the commit. A staged-hunk split that silently left half a change behind looks fine in
`git diff` and wrong in the commit.

## The message

The first line says what changed, in the imperative, in one line: *Fix session timeout on
token refresh*. Present tense, no trailing period, and short enough to read in a `--oneline`
listing.

The body explains **why**, and it is the only part with lasting value. The diff already shows
what changed; nobody can reconstruct why from it. Write what the reader will otherwise have to
guess:

- What was broken, or what was not possible before.
- Why this approach and not the obvious alternative — this is the single most useful sentence
  a commit message can contain, because it is what stops someone "simplifying" it back.
- Anything surprising: a constraint from an upstream API, a deliberate inconsistency, a
  workaround with a condition for removal.

Skip the body for genuinely self-evident changes. A typo fix does not need a paragraph, and a
body that only restates the subject teaches the next reader that bodies are noise.

Reference issues by identifier, but do not make the issue the explanation. Trackers get
migrated and links die; the commit is what survives.

## Amending and fixing up

Amend freely while the commit is only yours: `git commit --amend` for the immediate one, or
commit a `fixup!` and squash it later. A branch that ends in "fix typo", "fix typo again",
"actually fix it" makes the reviewer read three commits to learn nothing.

Stop amending the moment the commit is shared. See the sharing skill — the question is not
whether you *can* rewrite, it is who else already has it.

## Before committing

- Does `git diff --staged` contain only the change you mean to describe?
- Any debug output, commented-out code, or stray file?
- Does the subject line describe it without "and"?
- Does the body say why, or just repeat the diff?
- Does the tree build at this commit?

## Committing on behalf of someone

Commit only what was asked for. Sweeping unrelated working-tree changes into a commit the
user asked for is how someone's unfinished work ends up in history under a message that does
not mention it. If the tree holds changes outside the request, say so and ask, rather than
deciding for them.

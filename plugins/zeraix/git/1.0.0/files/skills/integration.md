---
id: git-integration
name: Opening and landing pull requests
version: 1.0.0
author: zeraix
audience: dev
scope: targeted
tags: [git, pull-request, review, merge, github]
description: Turn a finished branch into a pull request a reviewer can act on, and get it merged — what the description owes the reader, which merge strategy the repository uses, which checks must pass first, and what to do when something lands broken. Load this before opening or merging a pull request.
allowedTools: [run_command, read_file, fetch_url]
---

# Opening and landing pull requests

## Before opening one

Check the branch is actually ready, because everything after this point is visible to other
people:

- The working tree is clean and nothing stray is committed — debug output, local config,
  scratch files.
- It is current with its base, or close enough to merge cleanly.
- Its commits are coherent. Squash the fixups now; a reviewer reading "fix typo" three times
  learns nothing and reads three diffs to find out.
- The checks CI will run pass locally.

Push the branch. On the first push, set upstream (`git push -u origin <branch>`) so later
pushes need no arguments.

## Writing the pull request

Use `gh pr create` where the CLI is available — it fills the title and body from the branch's
commits and knows the repository's template. Read the template if there is one and fill it in
properly rather than deleting it; the questions in it are there because reviewers kept having
to ask them.

The description has one job: let a reviewer decide whether this is right without reconstructing
your reasoning from the diff.

- **What and why**, in a couple of sentences. The diff shows what changed; only you can supply
  why this change and not the obvious alternative.
- **Link the issue** with a closing keyword (`Closes #1234`) so it closes on merge. This is the
  only reliable way the issue and the fix stay connected once both are old.
- **How it was verified.** The test you added, the reproduction you ran, the platform you ran
  it on.
- **What you did not do.** Related problems you saw and deliberately left, and known
  limitations. This is the part most often omitted and most often needed — a reviewer who spots
  an untouched adjacent bug will assume you missed it.

Open it as a **draft** when the work is incomplete, when CI has not run yet, or when you want
early direction rather than approval. A draft says "look at the approach"; a ready pull request
says "this is finished", and opening one that is not wastes a reviewer's pass.

Keep it small. A pull request a reviewer can read in one sitting gets a real review; one that
cannot gets an approval that means nothing. If the branch grew past that, splitting it is
usually worth the effort.

## Landing it

Check status before merging, not assumptions: required checks green, required reviews
approved, no merge conflicts, no requested changes outstanding. `gh pr checks` and
`gh pr view` answer all of it.

**Match the repository's merge strategy** rather than picking one. Look at the base branch's
history — `git log --graph --oneline -20` shows it immediately:

- **Squash** if history is linear with one commit per pull request. Most repositories.
- **Merge commit** if merges are visible in the graph and branch structure is kept.
- **Rebase** if history is linear with the branch's individual commits preserved.

Merging against the repository's convention is a mess that has to be cleaned up by someone
else, and on a protected branch it may not be cleanable at all.

Delete the branch after merging — the remote copy, and the local one once it is merged. Then
sync: switch to the base, pull, and confirm the change is there. A local base branch that
still predates your own merge is where the next stale-branch problem starts.

## What not to do

**Do not merge without explicit approval**, and specifically do not merge a pull request you
opened because it looks ready. Merging is the least reversible thing in this workflow: on a
shared branch it triggers deployments, it is visible to everyone, and undoing it means a revert
commit that is itself part of history forever.

**Do not bypass required checks**, use admin merge powers, or merge with failing CI because the
failure "looks unrelated". Unrelated failures are how broken main branches start, and the check
was made required by someone who had a reason.

**Do not force-push a branch under review** without saying so. Reviewers lose their place and
their existing comments detach from the code. When a rebase is genuinely needed mid-review, say
so in a comment first.

## When something lands broken

Revert first, diagnose after. `git revert` on the merge restores a working base branch in one
commit and costs nothing but a line of history; leaving it broken while investigating blocks
everyone else's work.

Then reopen with a fix. A revert is not a failure — it is the mechanism working. What is a
failure is a base branch left broken for an afternoon because someone was determined to fix
forward.

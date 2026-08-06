---
id: git-history
name: Investigating history
version: 1.0.0
author: zeraix
audience: dev
scope: targeted
tags: [git, bisect, blame, log, debugging]
description: Find the commit that introduced a behaviour and understand why code looks the way it does. Load this when hunting a regression, when blame points at a reformatting commit, or when you need to know why a line exists before changing it.
allowedTools: [run_command, read_file, search_files]
---

# Investigating history

Git history answers two questions: *when did this change* and *why*. Most investigations fail
by reaching for the wrong tool for the question.

## Search by content, not by message

Commit messages describe intent, and the thing you are hunting is usually not what its author
thought they were doing. Search the diffs instead.

`git log -S'<string>'` finds commits where the number of occurrences of a string changed —
where it was introduced or removed. This is the workhorse: it answers "when did this config
key appear", "who deleted this call", "when did we stop passing that flag".

`git log -G'<regex>'` finds commits whose diff *matches* a pattern, including changes that
move a line without changing the count. Use it when `-S` finds nothing and you suspect the
line was modified rather than added.

Scope to a path (`git log -S'foo' -- src/auth/`) when the string is common. Add `--all` when
the change might live on a branch that was never merged to the one you are on.

## Blame past the noise

Plain `git blame` attributes every line to whichever commit last touched it, which is
routinely a reformat, a rename, or a lint pass. That is the wrong answer to the question you
are asking.

Ignore the noise: `-w` skips whitespace-only changes, `-M` follows lines moved within a file,
and `-C` follows lines copied from other files. Together they usually get from "the formatting
commit" to the commit that actually wrote the line.

When blame still lands on a mechanical commit, blame the parent: `git blame <sha>^ -- <file>`
walks back one step. Repeat until you reach a commit whose message is about behaviour.

Once you have a candidate, read the whole commit — `git show <sha>` — not just the line. The
surrounding change is what explains it, and often the message answers the question directly.

## Bisect with a script, not by hand

When you know a behaviour is broken now and worked before, bisect finds the exact commit in
logarithmic time. Two hundred commits is eight tests.

Drive it with a command rather than manually marking each step. `git bisect run <cmd>` uses
the exit status: zero is good, non-zero is bad, and **125 means skip** — the commit cannot be
tested (it does not build, a dependency is missing). Emitting 125 rather than failing is what
keeps a broken intermediate commit from being blamed for the bug.

The reproducer is the whole job. Before starting, write the smallest command that exits
non-zero on the current broken state and zero on a known-good commit, and verify it against
both ends by hand. A bisect driven by an unreliable test converges confidently on the wrong
commit, and nothing about the output will tell you that happened.

Watch for tests that depend on state outside the commit — a built artifact, a cached
dependency, a database schema. If the environment has to be rebuilt per step, put that in the
script too, or the results are meaningless.

`git bisect reset` when finished. A repository left mid-bisect is a detached HEAD that will
confuse the next thing you do.

## Reading a commit you did not write

Start with `git show --stat` to see the shape before the content: how many files, which
directories, whether it is one idea or several.

Then read the message for intent, the diff for mechanism, and — when it is still unclear —
`git log --oneline` around it for context. A commit that makes no sense alone is often the
second of three, and the one before it explains the setup.

## When history has been rewritten

Squashed merges and rebased branches lose the intermediate commits. If a squashed commit is
too large to understand, the original branch may still exist on the remote, or in a pull
request, or in someone's reflog. Say that the granularity was lost rather than guessing at
what the intermediate steps were.

## Reporting what you found

State the commit, what it changed, and the evidence that connects it to the symptom. Separate
what you verified from what you inferred — "bisect identifies abc1234, and reverting it fixes
the reproducer" is a different claim from "abc1234 touches this code path and looks likely",
and only the first justifies acting.

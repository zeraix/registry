---
id: git-issue-workflow
name: Fixing an issue end to end
version: 1.0.0
author: zeraix
audience: dev
scope: targeted
tags: [git, issues, github, workflow, branching]
description: The path from a reported issue to a branch with a fix on it — finding and reading the issue on the remote, deriving a branch name, and the rule that work never starts on the base branch. Load this whenever a task begins from an issue number, a bug report, or "fix this on GitHub".
allowedTools: [run_command, read_file, edit_file, search_files, fetch_url]
---

# Fixing an issue end to end

The sequence is fixed: **find the issue → branch → fix → verify → pull request → land**. This
skill covers the first half. Opening and merging the pull request is in the integration skill.

## Finding the issue

Search the remote before assuming a bug is unreported. A described symptom usually has an
issue already, and that issue often contains the reproduction, the affected version, and a
maintainer's opinion on the right fix — all of which change what you build.

The `gh` CLI (or `glab` for GitLab) is the best path when it is installed and authenticated:
it handles auth, enterprise hosts and pagination, and it is almost always already set up on a
machine that pushes to the remote. `gh issue list --search '<terms>'` and `gh issue view <n>`
are the two commands that matter. Check `gh auth status` before relying on it.

Search by symptom, not by the words you would use. Reporters describe what they saw, not the
mechanism — hunt for the error string, the failing endpoint, the version number. Search closed
issues too: a closed one is either the fix you are about to duplicate, or a regression, and
both are worth knowing before you write code.

When issue listings run long, delegate the search to the issue scout sub-agent and get back a
shortlist rather than pages of titles.

## Read the issue properly before starting

An issue is a report, not a specification. Extract, and state back:

- **The reproduction.** If there is not one, that is the first thing to establish — you cannot
  verify a fix for a bug you cannot trigger.
- **The expected behaviour**, and whether the reporter's expectation is actually correct.
  Sometimes the code is right and the documentation is wrong.
- **Scope.** Issues accumulate adjacent complaints in their comments. Fix the issue, not the
  thread; mention the rest rather than absorbing it.
- **Prior decisions.** A maintainer comment saying "we won't do X" outranks your judgement
  about X, and finding it after building X is expensive.

## Branch before touching anything

**Never start a fix on the base branch.** Check where you are — `git branch --show-current` —
before the first edit, not after. If it returns `main`, `master`, `develop`, or whatever this
repository integrates on, branch first.

This is not stylistic. Work started on the base branch has to be moved before it can be
reviewed, the move is fiddly once there are commits and a dirty tree, and on a repository that
allows direct pushes it can reach the shared branch by accident.

Branch from an **up-to-date** base: fetch, then branch from the remote's tip rather than from
whatever your local copy last saw. Branching from a stale base means resolving drift later
that you could have avoided entirely.

Name the branch after the work, and include the issue number if the repository does — look at
`git branch -a` for the existing convention and match it. `fix/1234-session-timeout` is
readable in a branch list; `patch-3` is not.

If you find yourself already on the base branch with uncommitted changes, do not panic and do
not reset: create the branch from where you are (`git switch -c <name>`), which carries the
working tree across untouched.

## While fixing

Reproduce the bug first, with a failing test where the project has tests. A fix that was never
observed to fail is a guess, and a test written after the fix frequently passes against the
broken code too.

Keep the branch to the issue. Adjacent problems you notice belong in a note to the user or a
new issue, not in this diff — a pull request that fixes the reported bug and also refactors
two neighbouring modules is one a reviewer cannot evaluate.

Commit as you go, following the commits skill. Reference the issue in the message body.

## Verify before going near a pull request

Run the reproduction and watch it pass. Run the project's tests, its linter, its build —
whatever CI will run, run it locally first, because a pull request that fails CI costs a
review cycle and tells everyone watching that it was not checked.

Then state plainly what you verified and what you did not. "Tests pass locally, but I could
not reproduce the original report on this platform" is a useful thing for a reviewer to know
and an invisible landmine if left unsaid.

## Acting on a repository that is not yours

Pushing a branch, opening a pull request and merging are outward-facing: other people see
them, CI runs on them, and notifications go out. The first push of a branch and the pull
request itself should be confirmed unless the user has said to go ahead — and approval for one
issue is not standing approval for the next.

Never push directly to the base branch, even where the remote permits it, and even for a
one-line fix. The branch-and-review path exists so that a mistake is caught while it is still
cheap to catch.

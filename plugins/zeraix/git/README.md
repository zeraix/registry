# zeraix/git

Git and forge workflow, end to end: search issues on the remote, branch before fixing, keep commits
reviewable, open a pull request, and land it. Plus the judgment parts — rebase-or-merge, conflict
resolution, finding the change that caused a bug, and getting work back after a bad command.

## Status

| Part | State |
|---|---|
| The seven skills | **Installable and live.** They reach the agent through `loadPluginSkills()`. |
| The four prompts and three sub-agents | Install, then sit inert — `loadPluginSkills()` filters on `type === "skill"`, so nothing consumes them yet. |
| The `forge` provider and its five tools | Not installable. `IMPLEMENTED_PROVIDER_KINDS` is `["text"]`, so `http` is published-but-not-runnable. CI warns once per tool; that is expected. |

## How the remote half works today

The `forge` provider declares the shape — `api.github.com`, a secret `FORGE_TOKEN`, a non-secret
`FORGE_API_URL` for enterprise instances — so the permission and credential surface gets reviewed
before anything depends on it. None of it runs yet.

**That is fine, because the skills do not depend on it.** They drive `gh` (or `glab`) through
`run_command`, which is already on any machine that pushes to the remote and already handles auth,
enterprise hosts, pagination and rate limits. So issue search, PR creation and merging work *now*,
and the provider is what replaces the CLI dependency later rather than what unblocks the feature.

The skills check `gh auth status` before relying on it and say so when it is missing, rather than
inferring from the code which issues probably exist.

## The workflow it encodes

`find the issue → branch → fix → verify → pull request → land`

Three points in that sequence are enforced rather than suggested, and each is worth keeping:

**A fix never starts on the base branch.** `issue-workflow.md` says to check
`git branch --show-current` before the first edit. Moving committed work off `main` afterwards is
fiddly, and on a repository allowing direct pushes it can reach the shared branch by accident. The
recovery path is `git switch -c` — which carries the working tree over untouched — not a reset.

**A pull request is confirmed, not automatic.** The first push of a branch and the PR itself are
outward-facing: notifications go out, CI runs, people look. `fix-issue.md` stops at that gate.

**Merging requires explicit approval**, and specifically the agent does not merge a PR it opened
because it looks ready. Merging is the least reversible step here — it can trigger deployments, and
undoing it means a revert that is itself permanent history.

The gates are placed by reversibility, not by risk-aversion: everything before the first push is
local and cheap to undo, and everything after it is someone else's problem to unwind. If you want
the unattended version, say so and the gates come out — but they should come out deliberately, not
by default.

## Layout

```
plugin.json                          the manifest
files/skills/issue-workflow.md       find the issue, read it properly, branch before touching code
files/skills/integration.md          PR descriptions, merge strategy, landing, reverting
files/skills/commits.md              splitting work, staging by hunk, what a message owes the reader
files/skills/branching.md            rebase vs merge, conflict resolution, interactive rebase
files/skills/history.md              log -S/-G, blame past reformatting, scripted bisect
files/skills/recovery.md             reflog, the three resets, what is genuinely unrecoverable
files/skills/collaboration.md        force-with-lease, rewriting shared history, rejected pushes
files/prompts/*.md                   fix an issue, investigate a regression, prepare, explain
files/agents/*.md                    issue scout, history investigator, conflict resolver
```

## Why there are no local git tools

The remote half gets a provider; the local half deliberately does not. An MCP server exposing
`git_log` and `git_diff` would be worse than nothing — the agent already has `run_command` and git
is already on the machine, so a tool layer adds a narrower second path and falls back to the shell
for everything it cannot express.

The remote is genuinely different: a network service with credentials, rate limits and an
enterprise-host variant. That earns a provider. `git log` does not.

## Known limitation

`permissions.network` is a hostname allowlist, so the declared provider reaches `api.github.com` and
nothing else. A self-hosted GitHub Enterprise or GitLab instance needs its own host in that list,
which means a manifest variant rather than a setting — `FORGE_API_URL` alone cannot widen the
allowlist, and should not be able to. This only affects the not-yet-runnable provider path; the CLI
path works against any host the CLI is configured for.

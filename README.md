# Zeraix plugin registry

The **[`zeraix/registry`](https://github.com/zeraix/registry)** repository. Everything about a
plugin — submission, review, publication, withdrawal — happens here, and nothing about it requires
an app release (see [plugin-marketplace-design.md](../docs/plugin-marketplace-design.md) §5.1).

## What lives here

```
plugins/<publisher>/<name>/<version>/plugin.json   a submitted manifest (sha512 omitted — CI computes it)
plugins/<publisher>/<name>/<version>/files/…       its artifacts
killlist.json                                      withdrawn plugins, hand-maintained
dist/                                              build output — generated, never committed
```

The app's **built-in skills** are not committed: the publish workflow regenerates them from
`src/skills/*.md` in the app repo on every run, so there is one copy of each skill and the two cannot
drift. That rule lives in `plugins/zeraix/.gitignore`, which the exporter writes with one entry per
generated skill — deliberately not a wildcard over the namespace, because hand-authored official
plugins live beside them and must be committed. Everything else, official or third-party, is
committed normally.

## Submitting a plugin

Open a pull request adding `plugins/<you>/<name>/<version>/`. CI validates it with no secrets, so it
works from a fork. A human merges; merging is what publishes.

**That is the entire process.** A plugin is a directory in this repository — adding one is a pull
request, removing one is an entry in `killlist.json`. There is nothing to build, no tool to install,
and no command to run: the index is assembled by CI from what is committed here. The app repository
supplies the validator the workflows borrow, but a plugin author never touches it.

**Start from [`plugins/zeraix/office-suite/`](plugins/zeraix/office-suite/)** rather than from the
schema. It is the official office plugin and doubles as the reference manifest: every structure the
schema defines — all six provider kinds, all nine capability types, and all three ways a capability
can be bound — with a README mapping each one to where it appears. Much of what it declares is
reserved rather than runnable today, and its README says which is which.

Copy its **shape**, not its publisher: `zeraix`, `official`, `system` and `admin` are reserved, and a
pull request from a fork claiming one fails validation. Submit under your own name.

Rules the validator enforces, so they are worth knowing before you write the manifest:

- The directory decides identity. `plugin.json`'s `id` must be `<you>/<name>` and its `version` must
  match the directory, or the build fails.
- **Do not hand-write `sha512`.** Ship the files; CI hashes them and injects the digests. A declared
  hash that disagrees with the bytes is an error, because it means the manifest and the artifact came
  from different builds.
- Versions are immutable. Never edit a version that has been published — add a new one.
- Anything a client would silently skip is an error here, not a warning. Publishing a capability no
  client can use is a mistake to catch in review.

## Withdrawing a plugin

Add an entry to `killlist.json` and merge:

```json
{
  "entries": [
    { "id": "alice/postgres", "version": "*", "reason": "exfiltrates database credentials" }
  ]
}
```

`version` is a specific version or `"*"`. Add `"capability": "<id>"` to withdraw one capability
rather than the whole plugin. `reason` is mandatory and is shown to affected users — a plugin that
disables itself without explanation is not an acceptable experience.

Withdrawal reaches installs that already have the plugin: clients check the kill-list at launch,
before any capability is offered. It cannot be undone by the user's enable toggle.

A malformed entry rejects the **whole** document rather than being skipped. Failing to revoke is the
exact outcome this file exists to prevent, so it fails loudly instead.

## No signing keys

There are none, by design. The feeds are plain JSON, and what stands behind them is **this repo**:
every entry got here through a reviewed, merged pull request, and the commit history is the audit
log. CI publishes to an origin we control and clients fetch over https.

What that means in practice, stated plainly rather than implied:

- Anyone who can write to the publish origin, or to this repo's `main`, can change what the
  marketplace offers. There is no second factor.
- What they still cannot do is swap the *bytes* of a plugin whose entry they did not also change:
  every artifact is pinned by `sha512` in the index, and the client verifies before writing.
- Nor can a cache or proxy quietly undo a withdrawal — see the sequence note below.

If that trade stops being acceptable — the usual trigger is the first `sandboxed` or `host` tier
plugin from a publisher we do not control — §5.1 of the design doc records what re-adding signing
would involve.

## Sequence numbers

Both feeds carry a monotonic `sequence`, and clients refuse anything below the one they already
hold. That is what stops a stale kill-list being replayed to un-revoke a plugin, and it is the one
protection that does not depend on the origin being honest.

`dist/` is never committed, so a CI run has no previous build to count from. **The publish workflow
passes `--sequence` from `github.run_number`**, which survives a fresh checkout and only ever climbs.
Do not remove that argument: without it every publish is sequence 1, the number never advances, and
the rollback check silently becomes a no-op.

## Which app version validates submissions

Both workflows borrow the validator from `zeraix/zeraix` rather than vendoring a copy, and they pin
that checkout to the app's **latest release tag** — not `main`. Validating against unreleased code
would accept manifests that every shipped client skips, and report it as a pass. See
[`.github/workflows/_app-checkout.md`](.github/workflows/_app-checkout.md).

Consequence worth knowing before the first publish: **the registry cannot publish until an app
release contains the plugin tooling.** Until then, set the `APP_REF` repository variable to a branch
or commit that has it (`main`, once the work is pushed) and clear it after the release ships.

## Before the publish origin exists

Publishing degrades rather than failing while the registry is being set up. With no `PLUGIN_BASE_URL`
the workflow validates every plugin, says so, and stops **green** — a red X on every merge would just
train everyone to ignore it.

A base URL with no `PUBLISH_URL` is different and fails loudly: it means feeds were built with real
artifact URLs and then went nowhere, which looks exactly like a successful publish from the outside.

## Setup checklist

0. Push the plugin tooling to `zeraix/zeraix` and cut a release containing it — or set `APP_REF` to a
   ref that has it. The workflows fail with an explicit message if the tooling is missing.
1. Stand up the publish endpoint (design doc §5.2 — still a TODO in `publish.yml`). It accepts
   `dist/{index,killlist}.json` plus the artifacts under `plugins/**/files/`, and serves them at
   `<api origin>/plugins/{index,killlist}.json` and `<PLUGIN_BASE_URL>/<publisher>/<name>/<version>/<file>`.
2. Set the `PLUGIN_BASE_URL` and `PUBLISH_URL` repository variables and the `PUBLISH_TOKEN` secret.
3. Flip `PLUGINS_UI_ENABLED` in the app's `src/constants/App.ts` and ship a release. Until then the
   client never configures the registry and makes no plugin requests.


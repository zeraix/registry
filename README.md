# Zeraix plugin registry

The **[`zeraix/registry`](https://github.com/zeraix/registry)** repository. Everything about a
plugin — submission, review, publication, withdrawal — happens here, and nothing about it requires
an app release (see [plugin-marketplace-design.md](../docs/plugin-marketplace-design.md) §5.1).

## What lives here

```
plugins/<publisher>/<name>/<version>/plugin.json   a submitted manifest (sha512 omitted — see below)
plugins/<publisher>/<name>/<version>/files/…       its artifacts
killlist.json                                      withdrawn plugins, hand-maintained
unlisted.json                                      plugins held back from the catalogue
dist/plugins/{index,killlist}.json                 the built feeds — generated, never hand-edited
```

What is committed under `plugins/` is what gets published. Nothing there is generated, and a plugin
author writes nothing else.

`dist/` is the exception, and it is a stopgap. Until the publish endpoint exists this repository *is*
the origin — the app fetches `dist/plugins/` from raw GitHub — so the publish workflow rebuilds both
feeds from the committed tree and pushes them back on every merge. **Never edit `dist/` by hand.**
Run `node .github/scripts/build-feeds.mjs --root . --app <app checkout>` if you need to see what a
merge would publish; a hand-written feed goes stale the moment a plugin lands, which is the bug this
builder exists to end.

Two things it will refuse, both of which have already happened once:

- **A digest taken from a modified working tree.** The feed pins the bytes the origin serves, which
  are the committed blobs. On a Windows checkout the working tree is CRLF and the blob is LF, so a
  feed built from unstaged files pins digests no client can ever reproduce — every install would fail
  its integrity check on the user's machine, long after review.
- **A sequence that does not climb.** Clients refuse any feed below the one they hold, so a counter
  (a CI run number, say) started next to a timestamp-shaped sequence would be refused by every client
  that has ever refreshed, permanently and silently. The builder derives the next value from the
  published feed and will not take an override below it.

A plugin can be committed but kept out of the catalogue by adding it to `unlisted.json` — for things
that exist to be copied rather than installed, like `zeraix/oauth-template`. The built-in skills are
left out too, since the app already ships all ten; `--include-generated` publishes them when the
marketplace is ready to replace that built-in set.

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
and no command to run — not for you and not in CI. CI only *checks* your submission; the catalogue
itself is assembled by the publish endpoint from what is committed here. The app repository supplies
the validator the workflows borrow, but a plugin author never touches it.

**Start from [`plugins/zeraix/office-suite/`](plugins/zeraix/office-suite/)** rather than from the
schema. It is the official office plugin and doubles as the reference manifest: every structure the
schema defines — all six provider kinds, all nine capability types, and all three ways a capability
can be bound — with a README mapping each one to where it appears. Much of what it declares is
reserved rather than runnable today, and its README says which is which.

Copy its **shape**, not its publisher: `zeraix`, `official`, `system` and `admin` are reserved, and a
pull request from a fork claiming one fails validation. Submit under your own name.

Rules the validator enforces, so they are worth knowing before you write the manifest:

- The directory decides identity. `plugin.json`'s `id` must be `<you>/<name>` and its `version` must
  match the directory, or validation fails.
- **Do not hand-write `sha512`.** Ship the files; the publish endpoint computes the digests from the
  bytes it receives. CI hashes them too, but only in memory so the validator has something to check —
  it writes nothing. A declared hash that disagrees with the bytes is an error, because it means the
  manifest and the artifact came from different sources.
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

Nothing in this repository assigns it. **The publish endpoint owns the sequence**, and it must climb
on every publish — a number that never advances turns the client's rollback check into a no-op, with
no error anywhere to say so.

## Where the validator comes from

Both workflows borrow one file from `zeraix/zeraix` rather than vendoring a copy:
`electron/plugins/manifest.mjs`, the client's own validator. That is what makes "CI passed" mean
"clients will accept this" — two copies of the schema would drift, and then the green check would be
telling you something it had not checked.

They track `main`, with no version resolution of any kind. An earlier design resolved the app's
latest *release* tag, which turned out to be the wrong trade twice over: it made CI **stricter** than
the schema (rejecting manifests that newer clients accept, since an unknown capability type is an
error in strict mode) while doing nothing about lagging clients, which already handle anything they
do not recognise by skipping it (design doc §7). What it did reliably produce was a deadlock —
nothing could publish until a release happened to contain the schema.

## Before the publish endpoint exists

Publishing degrades rather than failing while the registry is being set up. With no `PUBLISH_URL`,
the workflow validates every plugin, says so, and stops **green** — a red X on every merge would just
train everyone to ignore it.

## Setup checklist

0. Push the plugin schema to `zeraix/zeraix` `main`. The workflows fail with an explicit message if
   `electron/plugins/manifest.mjs` is not there; no release is required.
1. Stand up the publish endpoint (design doc §5.2 — still a TODO in `publish.yml`). It receives the
   committed `plugins/` tree and `killlist.json`, and owes the client four things nothing else can
   supply: `sha512` per artifact computed from the bytes, one document embedding every manifest, a
   monotonic feed `sequence`, and https artifact URLs. See the comment above the upload step.
2. Set the `PUBLISH_URL` repository variable and the `PUBLISH_TOKEN` secret.
3. Point `NEXT_PUBLIC_PLUGIN_ORIGIN` at it and stop tracking `dist/` (add `/dist` back to
   `.gitignore`). Serving the feeds from raw GitHub puts the integrity of every install behind a host
   this project does not control, and raw GitHub is unreachable from mainland China — the reason
   `registryClient.mjs` says nothing there fetches from GitHub.
4. Flip `PLUGINS_UI_ENABLED` in the app's `src/constants/App.ts` and ship a release. Until then the
   client never configures the registry and makes no plugin requests.


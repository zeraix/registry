# Zeraix plugin registry

Scaffold for the **`zeraix/registry`** repository. Copy this directory out into its own repo — it
does not belong in the app repo long-term, because the whole point of a separate registry is that
publishing a plugin does not require an app release (see
[plugin-marketplace-design.md](../docs/plugin-marketplace-design.md) §5.1).

## What lives here

```
plugins/<publisher>/<name>/<version>/plugin.json   a submitted manifest (sha512 omitted — CI computes it)
plugins/<publisher>/<name>/<version>/files/…       its artifacts
killlist.json                                      withdrawn plugins, hand-maintained
keys.json                                          root-signed release-key delegation (produced OFFLINE)
dist/                                              build output — generated, never committed
```

`plugins/zeraix/*` is **not committed**. Those are the app's built-in skills, and the publish
workflow regenerates them from `src/skills/*.md` in the app repo on every run. One copy of each
skill, in the app repo, so the two cannot drift — the same rule the bundled OCR adapter follows.
Third-party submissions under other publishers *are* committed.

## Submitting a plugin

Open a pull request adding `plugins/<you>/<name>/<version>/`. CI validates it with no secrets, so it
works from a fork. A human merges; merging is what publishes.

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

## Keys

Two tiers (design doc §5.1). The root is the trust anchor and **never touches CI**:

| Key | Where | Signs |
|---|---|---|
| Root | An offline machine, nowhere else | Only `keys.json` |
| Release | `REGISTRY_SIGNING_KEY` in this repo's Actions secrets | `index.json`, `killlist.json` |

`keys.json` is the root-signed document naming which release keys may sign feeds. Produce it on the
offline machine and commit the result — it contains no secrets. `sign-delegation.mjs` imports nothing
from the app repo, so that machine needs Node and that one file, not a checkout:

```bash
# on the offline machine, with rel-*.pub copied over (public half only)
node sign-delegation.mjs \
  --root-key root-2026.pem --root-key-id root-2026 \
  --key rel-2026-08.pub --out keys.json
```

**Keys do not expire.** Revocation is the mechanism: if a release key leaks, re-run without it and
every install that fetches the new delegation stops accepting its signatures. An expiry window would
add a backstop against a leak nobody ever notices, at the cost of a recurring offline ceremony that
takes the whole marketplace down if it is ever missed. Pass `--months N` if you want one anyway.

To rotate: sign a delegation listing both keys, switch CI to the new one, then re-issue without the
old. The sequence number climbs on every issuance, which is what stops an old delegation being
replayed to hand a revoked key its authority back.

## Which app version validates submissions

Both workflows borrow the validator from `zeraix/zeraix` rather than vendoring a copy, and they pin
that checkout to the app's **latest release tag** — not `main`. Validating against unreleased code
would accept manifests that every shipped client skips, and report it as a pass. See
[`.github/workflows/_app-checkout.md`](.github/workflows/_app-checkout.md).

Consequence worth knowing before the first publish: **the registry cannot publish until an app
release contains the plugin tooling.** Until then, set the `APP_REF` repository variable to a branch
or commit that has it (`main`, once the work is pushed) and clear it after the release ships.

## Before the keys exist

Publishing degrades rather than failing while the registry is being set up. With no signing key and
no `keys.json`, the publish workflow validates every plugin, says so, and stops **green** — a red X
on every merge would just train everyone to ignore it.

Half-configured is different and fails loudly: a release key with no delegation would sign feeds
every client rejects, and a delegation with no key authorizes nothing. Both are mistakes; neither is
a state you pass through on purpose.

## Setup checklist

0. Push the plugin tooling to `zeraix/zeraix` and cut a release containing it — or set `APP_REF` to a
   ref that has it. The workflows fail with an explicit message if the tooling is missing.
1. Generate the root key on an offline machine —
   `node scripts/gen-registry-key.mjs --role root --key-id root-2026`
2. Paste its public key into `TRUSTED_ROOT_KEYS` in `electron/plugins/signature.mjs` and **ship a
   client release**. Clients only accept a delegation signed by a root key they already embed, so
   nothing works until a build carrying it is out.
3. Generate a release key. Paste its PEM straight into the `REGISTRY_SIGNING_KEY` secret (no
   base64 needed), take the `.pub` to the offline machine, and sign `keys.json`.
4. Set the `PLUGIN_BASE_URL` and `PUBLISH_URL` repository variables (see `publish.yml`). The release
   key id is read from `keys.json`, so there is nothing to configure for it.

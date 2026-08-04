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

`keys.json` is the root-signed document naming which release keys may sign feeds, and for how long.
Produce it on the offline machine and commit the result — it contains no secrets:

```bash
# on the offline machine, with rel-*.pub copied over (public half only)
node scripts/sign-delegation.mjs \
  --root-key ~/keys/root-2026.pem --root-key-id root-2026 \
  --key rel-2026-08.pub --months 6 --out keys.json
```

**Re-issue before it expires.** Clients stop accepting anything the registry signs once the window
closes, and the fix requires a human at the offline machine. The app warns 30 days out.

To rotate: sign a delegation listing both keys, switch CI to the new one, then re-issue without the
old. To revoke a leaked release key: re-issue without it. The sequence number must climb, which is
what stops the old delegation being replayed to hand the leaked key its authority back.

## Setup checklist

1. Generate the root key on an offline machine —
   `node scripts/gen-registry-key.mjs --role root --key-id root-2026`
2. Paste its public key into `TRUSTED_ROOT_KEYS` in `electron/plugins/signature.mjs` and **ship a
   client release**. Clients only accept a delegation signed by a root key they already embed, so
   nothing works until a build carrying it is out.
3. Generate a release key, store the private half as `REGISTRY_SIGNING_KEY`, take the `.pub` to the
   offline machine, and sign `keys.json`.
4. Set the `PLUGIN_BASE_URL` and `PUBLISH_URL` repository variables (see `publish.yml`).

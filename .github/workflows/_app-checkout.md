# Why the app checkout is pinned to a release

Both workflows check out `zeraix/zeraix` to borrow one file: `electron/plugins/manifest.mjs`, the
validator. Vendoring a copy here would let the two drift, and then "strict mode passed" would stop
meaning "clients will accept this" — which is the entire value of validating at review time
(design doc §5.4).

That argument only holds if we validate with the code **users are actually running**. The default
branch is not that. If `main` adds a capability type or implements a new provider kind, validating
against it would accept manifests that every shipped client skips — inverting the guarantee into
its opposite, silently, with a green check.

So the checkout resolves the app's **latest release tag**, not `main`. Override with the `APP_REF`
repository variable to pin an exact tag (useful when a release is mid-flight, or to reproduce an old
build).

Residual, accepted: users run a spread of versions, not just the latest, so a manifest validated here
can still use something a *lagging* client does not implement. That case is what the skip-unknown
rules in §7 are for — an older client drops the capability it does not understand and installs the
rest. Validating against the oldest supported client instead would be stricter, and would hold the
registry back to the least-updated user in the field; it is not worth that.

## Before any release has the schema

There is a bootstrap window where the rule above cannot be satisfied: the latest release predates
`electron/plugins/manifest.mjs`, so the checkout resolves to a tag that has nothing to validate with,
and both workflows fail on purpose.

Set `APP_REF` to `main` to get through it:

```bash
gh variable set APP_REF --body main --repo zeraix/registry
```

**Delete the variable once a release contains the schema.** Leaving it pinned to `main` is the exact
failure this file exists to prevent, and it fails silently — manifests get accepted that every
shipped client skips, reported as a pass.

Neither workflow falls back to `main` by itself, and neither skips validation when the validator is
absent. Both would turn a red check into a green one that verified nothing, and since feeds are
unsigned (design doc §5.1) review is the only gate there is.

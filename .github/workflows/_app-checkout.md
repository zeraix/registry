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

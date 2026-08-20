# OAuth plugin template

A starting point for a plugin that calls a third-party API on the user's behalf. Copy
`1.0.0/plugin.json` to `<publisher>/<name>/1.0.0/` and rename the placeholders — it validates as-is,
so a copy is a working base rather than something to debug into existence.

Change, in order:

1. `id` to `<publisher>/<name>`, matching the directory path.
2. `name` and `description` — user-facing. Users never see the word "capability".
3. `oauth.known_provider` — `google`, `github`, `slack`, `figma` or `microsoft`. Presets live in the
   app repo (`electron/plugins/manifest.mjs`); adding one is an app change, not a manifest change.
4. `oauth.scopes` — exactly what you need. These appear verbatim on the provider's consent screen.
5. `oauth.mints` and the consumer's `permissions.credentials` — any identifier, but they must match.
6. `provider_api.url` and `permissions.network` for the API you call.
7. The capability id, name and description.

Rename the provider keys too (`provider_auth` → `figma_auth`); only `auth` and
`capabilities[].provider` have to agree with them.

**Note for maintainers:** this directory is enumerated by the index build like any other plugin, so it
publishes to the catalogue as an installable plugin that does nothing. If that is not wanted, it
belongs in the app repo's `plugins/` tree instead, or the index build needs an exclusion rule.

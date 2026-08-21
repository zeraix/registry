# Gmail

Sends email from chat through the user's own Gmail account.

This is the reference implementation of the **`oauth` provider kind**. Its shape is worth copying:

```
send_email  ──provider──▶  gmail_api (http)  ──auth──▶  google_auth (oauth)
```

- `google_auth` holds the grant. `tier: host`, because driving the system browser and the OS keychain
  are host capabilities.
- `gmail_api` makes the call and stays `tier: sandboxed`. It never receives the token — the host adds
  `Authorization: Bearer …` at request time.
- No capability binds to `google_auth`; validation refuses it. The authorizer is referenced through
  `auth`, never bound to.

**The manifest declares no credentials.** `client: { "type": "host" }` means the build supplies the
client id and secret, the same way it supplies the endpoint URLs. There is no client id, no secret, no
refresh URL and no expiry handling anywhere in this file — a published manifest is world-readable, and
anything credential-shaped in one is disclosed by definition.

## Scope

`gmail.send` only. It is a **sensitive** scope, so the app must clear Google verification before any
non-test user can consent, and every additional sensitive scope re-opens that review for the whole app.

## What works today

`gmail_etiquette` (the skill) installs now. `send_email` validates and publishes but installs nothing
until the `http` provider executor lands — `tool` and `http` are not yet implemented, which the
validator prints on every run so it is not discovered after shipping.

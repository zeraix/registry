# zeraix/gmail

The full Gmail API as plugin tools — 79 capabilities, one per method of Gmail API v1.

## Generated, not hand-written

`plugin.json` is produced by `scripts/gen-gmail-plugin.mjs` in the app repository from Google's own
[discovery document](https://gmail.googleapis.com/$discovery/rest?version=v1). Do not edit it by
hand: 79 hand-copied paths, verbs and required parameters are 79 chances to produce a tool that fails
at run time as an unexplained 404, and the next regeneration would silently revert the fix anyway.

To pick up a new API revision, bump the version directory and re-run:

```
node scripts/gen-gmail-plugin.mjs --out <registry checkout>
```

The generator prints any method no declared scope covers, rather than dropping it quietly.

## What it asks for, and why it is a lot

```
https://mail.google.com/                              full mailbox access
https://www.googleapis.com/auth/gmail.settings.basic
https://www.googleapis.com/auth/gmail.settings.sharing
```

This is what "all Gmail APIs" costs. The narrower scopes cannot reach modify, delete or history, and
Google keeps the settings scopes separate — without them every `settings.*` method returns 403 even
with full mail access. A user installing this grants an application on their machine the ability to
read, send and delete their entire mailbox, and the consent sheet says so in those words.

**If you only need to send mail, install [`zeraix/gmail-send`](../gmail-send) instead.** It asks for
`gmail.send` alone, which cannot read a single message.

## Credentials

`client: { "type": "host" }` — the OAuth client belongs to the build, so the manifest contains no id,
no secret, and asks the user for nothing. The grant is obtained when the plugin is installed, stored
encrypted by the OS keychain, and spent per request inside the main process; it is never written to
the manifest, to plugin config, or to any environment variable.

## Shape of a tool

Every capability is one method, named for it:

```
plugin__zeraix_gmail__users_messages_send   POST /gmail/v1/users/me/messages/send
plugin__zeraix_gmail__users_messages_list   GET  /gmail/v1/users/me/messages
plugin__zeraix_gmail__users_labels_create   POST /gmail/v1/users/me/labels
```

`userId` is fixed to `me` rather than exposed: it is always the authorized account, and leaving it to
the caller means 79 tools that can each be pointed at the wrong mailbox by mistake.

Methods taking a request resource accept it whole as `body`, matching the API's own schema — the
Gmail documentation is the reference for those, and duplicating it here would be a second copy free
to drift.

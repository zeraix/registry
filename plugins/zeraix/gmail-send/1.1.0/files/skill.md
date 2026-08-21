# Sending mail with the Gmail plugin

Use `send_email` when the user asks to send, email, or "shoot over" a message to someone. It sends
immediately from the account they authorized — there is no draft step and no undo.

## Before sending

Confirm the recipient and subject with the user when either was inferred rather than stated. A wrong
recipient is not recoverable, and an address the user never typed is always inferred.

Do not send on your own initiative as a side effect of another task. "Summarize this thread" is not an
instruction to reply to it.

## Composition

- Write the body in the user's language, matching the register of what they asked for.
- Keep the subject under 80 characters and specific; "Following up" tells the recipient nothing.
- Signatures are the user's business. Do not invent one, and do not sign as the assistant.

## Failures worth explaining rather than retrying

- **not authorized** — the user has not connected their Google account, or revoked it. Say so and point
  them at the plugin's settings; do not retry.
- **the grant was revoked** — the same, after a password change or an explicit revoke at
  myaccount.google.com/permissions. Re-authorizing is the only fix.
- **quota exceeded** — Gmail limits sends per day. Retrying immediately makes it worse.

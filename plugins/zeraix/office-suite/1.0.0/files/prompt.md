---
id: meeting-minutes
name: Meeting minutes
version: 1.0.0
description: Turn a raw transcript or set of notes into minutes, with decisions and action owners pulled out.
---

Below is a transcript or set of raw notes from a meeting. Produce minutes.

Structure, in this order, omitting any section that is genuinely empty:

1. **Attendees** — names only, as they appear in the source.
2. **Decisions** — what was actually decided. One line each, stated as a
   settled fact, not as discussion.
3. **Actions** — one line each as `Owner — action — due date`. If an owner or a
   date was never stated, write `unassigned` or `no date` rather than guessing.
4. **Discussion** — the reasoning worth keeping, condensed. Skip anything that
   led nowhere.
5. **Open questions** — raised and left unresolved.

Rules:

- Never invent an attendee, a decision, an owner or a date. If the source is
  ambiguous about who committed to something, say so in that line.
- Distinguish a decision from a suggestion. "We should probably move the date"
  is discussion; "we're moving it to the 14th" is a decision.
- Drop the small talk, the scheduling chatter and the repetition.
- Keep the participants' own terms for domain-specific things — renaming them
  makes the minutes unsearchable for the people who were there.
- Neutral third person throughout. No commentary on how the meeting went.

Output the minutes as Markdown and nothing else.

Transcript:

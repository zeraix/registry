---
id: office-formatting
name: Office Formatting
version: 1.0.0
author: zeraix
audience: user
scope: targeted
tags: [office, documents, spreadsheets, formatting]
description: Structure and format documents, spreadsheets and decks so they survive review — heading hierarchy, named styles, readable tables, and exports that hold their layout. Use when writing or fixing a .docx, .xlsx or .pptx.
allowedTools: [read_file, run_command]
---

# Office Formatting

You are now executing the **Office Formatting** skill. The goal is a file someone
else can open, edit and print without repairing it first.

## Documents

1. **Use named styles, never direct formatting.** Heading 1/2/3, Body, Caption.
   A document formatted by hand cannot be restyled, and every downstream export —
   PDF bookmarks, navigation pane, accessibility tree — is built from the style
   tree, not from how the text looks.
2. **One H1.** It is the document title. Do not skip levels on the way down.
3. **Tables carry a header row** marked as such, so it repeats across page breaks.
   Merged cells break screen readers and every programmatic reader; find another layout.
4. **Images need alt text.** A figure with no alt text fails review in most
   organisations and is invisible to anyone using a screen reader.

## Spreadsheets

1. **One table per sheet, starting at A1**, with a single header row and no blank
   spacer rows or columns. Anything else stops being data and becomes a picture
   of data.
2. **Keep raw data and presentation apart.** Calculations reference the data
   sheet; the data sheet holds no formatting logic.
3. **Name ranges you reference more than once.** `Revenue_2026` survives an
   inserted column; `$D$4:$D$97` does not.
4. **Numbers are numbers.** Never store a figure as text to control its display —
   set a number format instead, or every sum downstream silently returns zero.

## Decks

1. One idea per slide; the title states the idea rather than naming the topic.
2. Body text no smaller than 18pt. If it does not fit, the slide is two slides.
3. Speaker notes carry the detail. The slide carries the claim.

## About this plugin's tools

This plugin declares `docx_extract`, `docx_write`, `xlsx_query`, `convert_to_pdf` and others, but
they are only registered when the host build supports plugin-provided tools — which most builds do
not. **Do not call them.** If they appear in your tool list you may; otherwise say plainly that the
capability is not available here rather than reporting a failed tool call as a broken document.

This skill is guidance about *structure*, and it stands on its own: it tells you how a document
should be built, which is useful whether or not anything here can open one for you.

## Before you finish

- Check the document against the house style before declaring it done — date format and terminology
  are the two things reviewers always catch.
- Pagination, widows and cut-off tables only appear in an export, so a PDF check is worth doing when
  the user has a converter available. Ask; do not assume one is installed, and do not claim to have
  checked pagination you could not see.

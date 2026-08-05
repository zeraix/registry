---
id: powerpoint-decks
name: Working with PowerPoint decks
version: 1.0.0
author: zeraix
audience: user
scope: targeted
tags: [office, powerpoint, pptx, presentations]
description: Read .pptx decks correctly — slide titles, bullet hierarchy and speaker notes — and know why the notes usually matter more than the slides. Use whenever a task involves a presentation.
allowedTools: [run_command, read_file]
---

# Working with PowerPoint decks

## Reading one

> **About this plugin's `pptx_to_markdown / pptx_outline / pptx_notes` tools.** This plugin ships them, but they are only registered
> when the host build supports plugin-provided tools — which most builds do not. **Do not call them.**
> If they appear in your tool list you may use them; otherwise the method below reads the same file
> and needs nothing installed. Never report a failed tool call as "the document could not be read".

A `.pptx` is a ZIP of XML. Read it with Python's standard library via `run_command` — nothing to
install, works on any host. **Always read the speaker notes too** (`ppt/notesSlides/notesSlideN.xml`):
a slide carries the claim, the notes carry the argument, and a summary built from slides alone is
usually a list of headlines:

```bash
python -c "
import re,sys,zipfile
z=zipfile.ZipFile(sys.argv[1])
for n in sorted([n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$',n)], key=lambda s:int(re.search(r'(\d+)',s).group())):
    print('---',n)
    for p in re.findall(r'<a:p[ >].*?</a:p>', z.read(n).decode('utf8'), re.S):
        t=''.join(re.findall(r'<a:t[^>]*>(.*?)</a:t>', p, re.S))
        if t.strip(): print(t)
" review.pptx
```

Never use `read_file` on a `.pptx` — it is a binary archive.

## Traps that make extraction wrong

- **The title is declared, not positional.** It is the shape carrying `<p:ph type="title"/>` or
  `"ctrTitle"`. Shape order is authoring order, so "the first shape" is the title only by luck, and
  is wrong on any deck the author rearranged.
- **Text is split across runs**, exactly as in Word. Concatenate every `<a:t>` in a paragraph first.
- **Bullet depth lives in `lvl`** on the paragraph properties. Drop it and a structured argument
  flattens into an undifferentiated list.
- **Notes repeat the slide.** The notes part contains placeholder shapes echoing the slide's own
  text; strip those or every note comes back with the slide duplicated inside it.
- **Slide numbering is not zero-padded** — `slide2.xml` sorts after `slide10.xml` as a string. Sort
  numerically or the deck comes back out of order.
- **`.ppt` is not `.pptx`.** The pre-2007 binary format is not a ZIP.

## Answering from a deck

- Cite slide numbers; they are what the user is looking at.
- Distinguish what the slide asserts from what the notes qualify. "Revenue up 18%" on the slide and
  "before the audit lands" in the notes are not the same claim, and reporting only the first is how a
  deck misleads.
- Decks compress. If a conclusion depends on a number with no source on the slide, say the deck does
  not support it rather than inferring.

---
id: word-documents
name: Working with Word documents
version: 1.0.0
author: zeraix
audience: user
scope: targeted
tags: [office, word, docx, documents]
description: Read and reason about Word .docx files correctly — heading structure, tables, and the traps that make naive extraction wrong. Use whenever a task involves a .docx.
allowedTools: [docx_to_markdown, docx_outline, docx_tables, run_command, read_file]
---

# Working with Word documents

## Reading one

**If `docx_to_markdown` is available, use it.** For a long document, call `docx_outline` first to
find the section you need, then read only that. `docx_tables` returns figures as structured rows —
use it whenever the answer depends on a number, rather than reading them out of prose.

**If those tools are not available**, a `.docx` is a ZIP of XML and you can read it with Python's
standard library — no install required:

```bash
python -c "
import re,sys,zipfile
xml=zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode('utf8')
for p in re.findall(r'<w:p[ >].*?</w:p>', xml, re.S):
    t=''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, re.S))
    if t.strip(): print(t)
" report.docx
```

Never use `read_file` on a `.docx`. It is a binary archive; you will get compressed bytes and
conclude the document is empty or corrupt.

## Traps that make extraction wrong

- **Text is split across runs.** Word breaks a sentence into several `<w:t>` elements at arbitrary
  points — a spell-check boundary, a tracked change, a font switch. Concatenate every run in a
  paragraph before reading it, or you will silently lose half of it.
- **Headings are a style, not an element.** There is no heading tag; a heading is a paragraph whose
  `w:pStyle` is `Heading1`, `Heading2`, and so on. Ignore this and the document has no structure.
- **Tables contain paragraphs.** A naive "find every paragraph" pass returns each table cell a second
  time as loose text, so the document reads with its tables duplicated and interleaved.
- **`.doc` is not `.docx`.** The pre-2007 format is not a ZIP and none of this works on it. Say so
  rather than reporting a corrupt file.

## Answering from a document

- Quote figures exactly as written, including the currency symbol and separators.
- When the text and a table disagree, say so — that discrepancy is usually the most useful thing you
  can report, and it is the one a human reviewer skims past.
- Cite the heading a claim came from, not a page number: pagination depends on the renderer, and
  headings are stable.

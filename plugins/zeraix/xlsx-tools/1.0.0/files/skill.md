---
id: excel-spreadsheets
name: Working with Excel spreadsheets
version: 1.0.0
author: zeraix
audience: user
scope: targeted
tags: [office, excel, xlsx, spreadsheets, data]
description: Read .xlsx workbooks correctly — shared strings, sparse rows, cached formula results — and reason about the numbers rather than their rendered text. Use whenever a task involves a spreadsheet.
allowedTools: [run_command, read_file]
---

# Working with Excel spreadsheets

## Reading one

> **About this plugin's `xlsx_sheets / xlsx_read_sheet / xlsx_to_markdown` tools.** This plugin ships them, but they are only registered
> when the host build supports plugin-provided tools — which most builds do not. **Do not call them.**
> If they appear in your tool list you may use them; otherwise the method below reads the same file
> and needs nothing installed. Never report a failed tool call as "the document could not be read".

A `.xlsx` is a ZIP of XML. Read it with Python's standard library via `run_command` — nothing to
install, works on any host. A workbook's interesting sheet is rarely the first, so check the sheet
names in `xl/workbook.xml` before assuming `sheet1`:

```bash
python -c "
import re,sys,zipfile
z=zipfile.ZipFile(sys.argv[1])
sst=re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode('utf8'), re.S) if 'xl/sharedStrings.xml' in z.namelist() else []
sst=[''.join(re.findall(r'<t[^>]*>(.*?)</t>', s, re.S)) for s in sst]
for row in re.findall(r'<row[ >].*?</row>', z.read('xl/worksheets/sheet1.xml').decode('utf8'), re.S):
    out=[]
    for attrs,inner in re.findall(r'<c([^>]*)>(.*?)</c>', row, re.S):
        v=re.search(r'<v>(.*?)</v>', inner, re.S)
        v=v.group(1) if v else ''
        out.append(sst[int(v)] if 't=\"s\"' in attrs and v else v)
    print('\t'.join(out))
" finance.xlsx
```

Never use `read_file` on a `.xlsx` — it is a binary archive.

## Traps that make extraction wrong

- **Text lives in a shared string table.** Cells store an index into `xl/sharedStrings.xml`, not the
  text. Read a sheet without resolving it and you get a grid of integers that look like data.
- **Rows are sparse.** Excel omits empty cells entirely, so the third `<c>` in a row is not
  necessarily column C. Position cells by their `r="B7"` reference, or every row after the first gap
  is shifted and every column reads against the wrong header.
- **Formula cells carry a cached result.** `<f>` is the formula, `<v>` is the last value Excel
  computed. Read `<v>`; do not try to evaluate the formula.
- **Numbers formatted as text are a different thing.** A cell displaying `1,250` may be a string. If
  a total looks wrong, check the cell type before trusting the arithmetic.
- **`.xls` is not `.xlsx`.** The pre-2007 binary format is not a ZIP and none of this works.

## Answering from a spreadsheet

- Compute from the typed values, never from a rendered table you produced earlier — rounding in the
  display is not rounding in the data.
- State the sheet name and the range you used. "Revenue is £2,230.50" is unverifiable; "Q1!B4 totals
  £2,230.50" can be checked.
- If a stated total disagrees with the sum of its parts, report the discrepancy rather than picking
  one. That is nearly always the finding worth having.

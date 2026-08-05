#!/usr/bin/env node
/**
 * Excel (.xlsx) reader, exposed over MCP stdio.
 *
 * Declared by providers.xlsx: kind "mcp-stdio", tier "sandboxed", entry "server/index.js". The
 * registry hashes this file and the endpoint pins the digest in the index, so the bytes that run are
 * the bytes that were reviewed.
 *
 * ZERO DEPENDENCIES, deliberately. A sandboxed provider runs inside the microVM with only the
 * filesystem grants the manifest asks for and no network; there is no npm install step and no
 * node_modules to reach. Everything below -- ZIP central directory, DEFLATE via node:zlib, and the
 * OOXML shapes -- is implemented here so the bundle is exactly what the digest covers.
 *
 * Read-only. It opens .xlsx files and returns their content; it never writes one.
 */
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const WORKSPACE = path.resolve(process.env.ZERAIX_WORKSPACE ?? process.cwd());

/* ------------------------------------------------------------------ paths */

/**
 * Resolve a caller-supplied path inside the workspace.
 *
 * Checked AFTER resolution, not on the raw string: "a/../../etc/passwd" only reveals itself as an
 * escape once resolved, and screening the input for ".." misses every other spelling of it. The
 * sandbox would refuse this too; doing it here as well means the check does not depend on the
 * sandbox being present.
 */
function resolveInWorkspace(relPath) {
  if (typeof relPath !== "string" || !relPath) throw new Error("path is required");
  const abs = path.resolve(WORKSPACE, relPath);
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) {
    throw new Error(`path escapes the workspace: ${relPath}`);
  }
  return abs;
}

/* ------------------------------------------------------------------ zip */

/**
 * Read one entry out of a ZIP archive. OOXML files are ZIPs of XML parts.
 *
 * Driven by the central directory rather than by scanning for local headers: a local header repeats
 * the name and sizes, but its size fields may be zeroed with the real values in a trailing data
 * descriptor, so trusting them silently truncates entries written by streaming producers. The
 * central directory always carries the authoritative sizes.
 */
function readZipEntry(buf, wanted) {
  // End of central directory: signature 0x06054b50. Scan back from the end; the trailing comment is
  // at most 64 KiB, so there is no reason to search further than that.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (name === wanted) {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
      // The local header's own name/extra lengths are the ones that describe ITS layout, and the
      // extra field routinely differs in length from the central copy.
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compressedSize);
      if (method === 0) return raw; // stored
      if (method === 8) return zlib.inflateRawSync(raw); // deflate
      throw new Error(`unsupported zip compression method ${method} for ${name}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Every entry name in the archive, for parts whose names are not fixed (slides, sheets). */
function listZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    names.push(buf.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return names;
}

/* ------------------------------------------------------------------ xml */

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode the five predefined entities plus numeric references.
 *
 * Callers join every run BEFORE calling this, never after. A run boundary can fall inside an entity
 * -- "&am" + "p;" -- and decoding each half separately leaves a literal "&amp;" in the output that
 * nothing downstream will ever fix.
 */
function decodeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[ref] ?? m;
  });
}

/** Text of every `<tag ...>…</tag>`, in document order. Self-closing tags yield nothing. */
function tagTexts(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/* ------------------------------------------------------------------ xlsx */

/** "A1" -> { col: 0, row: 0 }. Cells are sparse in OOXML, so the reference is what positions them. */
function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref ?? "");
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

/**
 * The shared string table.
 *
 * Excel stores most text once here and references it by index, so a worksheet read without it comes
 * back as a grid of integers. An `<si>` may hold either a single `<t>` or several `<r>` runs that
 * have to be concatenated -- the same run-splitting Word does, for the same reasons.
 */
function sharedStrings(zip) {
  const xml = readZipEntry(zip, "xl/sharedStrings.xml");
  if (!xml) return [];
  return tagTexts(xml.toString("utf8"), "si").map((si) => decodeXml(tagTexts(si, "t").join("")));
}

/**
 * Sheet names in workbook order, paired with their part paths.
 *
 * Part paths are addressed through workbook rels in the spec. Every producer writes sheet1..sheetN
 * in workbook order, and resolving the ordinal keeps this dependency-free; a name that does not
 * resolve reads as empty rather than throwing.
 */
function sheetList(zip) {
  const wb = readZipEntry(zip, "xl/workbook.xml");
  if (!wb) throw new Error("no xl/workbook.xml -- is this an Excel file?");
  const names = [...wb.toString("utf8").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  return names.map((name, i) => ({ name, part: `xl/worksheets/sheet${i + 1}.xml` }));
}

/**
 * One worksheet as a dense array of rows.
 *
 * Cells carry their own type: `t="s"` indexes the shared table, `t="inlineStr"` carries `<is><t>`,
 * `t="b"` is a boolean, and a formula cell has `<f>` plus the cached `<v>` that is read here. Numbers
 * are returned as numbers rather than strings, which is the whole point of reading the file instead
 * of its rendered text -- a total can be checked.
 */
function readSheet(zip, part, strings, limit = Infinity) {
  const xml = readZipEntry(zip, part);
  if (!xml) return [];
  const rows = [];
  for (const rowXml of tagTexts(xml.toString("utf8"), "row")) {
    const cells = [];
    for (const m of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1] ?? "";
      const inner = m[2] ?? "";
      const ref = parseRef(/\br="([A-Z]+\d+)"/.exec(attrs)?.[1]);
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const raw = tagTexts(inner, "v")[0];

      let value = null;
      if (type === "s") value = strings[Number(raw)] ?? null;
      else if (type === "inlineStr") value = decodeXml(tagTexts(inner, "t").join(""));
      else if (type === "b") value = raw === "1";
      else if (raw !== undefined) {
        const n = Number(decodeXml(raw));
        value = Number.isFinite(n) ? n : decodeXml(raw);
      }
      // A cell with a reference goes to its column; one without keeps document order. Sparse rows
      // are normal -- Excel omits empty cells entirely.
      if (ref) cells[ref.col] = value;
      else cells.push(value);
    }
    rows.push(cells);
    if (rows.length >= limit) break;
  }
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined ? null : r[i])));
}

function openWorkbook(relPath) {
  const abs = resolveInWorkspace(relPath);
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${relPath}`);
  const ext = path.extname(abs).toLowerCase();
  if (ext !== ".xlsx" && ext !== ".xlsm") {
    // .xls is the pre-2007 binary format and is not a ZIP at all; saying so beats "not a zip archive".
    throw new Error(`expected a .xlsx file, got "${ext || "no extension"}"`);
  }
  return fs.readFileSync(abs);
}

/** Pick a sheet by name, or by 1-based index, defaulting to the first. */
function pickSheet(sheets, wanted) {
  if (wanted === undefined || wanted === null || wanted === "") return sheets[0];
  const byName = sheets.find((s) => s.name === wanted);
  if (byName) return byName;
  const n = Number(wanted);
  if (Number.isInteger(n) && n >= 1 && n <= sheets.length) return sheets[n - 1];
  throw new Error(`no sheet "${wanted}" (have: ${sheets.map((s) => s.name).join(", ")})`);
}

/* ------------------------------------------------------------------ tools */

const TOOLS = [
  {
    name: "xlsx_sheets",
    description:
      "List the sheets in an Excel workbook with their row and column counts. Call this first when " +
      "you do not know which sheet holds the data you need.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative path to the .xlsx" } },
      required: ["path"],
    },
  },
  {
    name: "xlsx_read_sheet",
    description:
      "Read a sheet as rows of typed cell values -- numbers stay numbers, so totals can be checked " +
      "rather than re-read off rendered text. Formula cells return their cached result. Pass " +
      "max_rows on a large sheet.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to the .xlsx" },
        sheet: { type: "string", description: "Sheet name or 1-based index; defaults to the first" },
        max_rows: { type: "number", description: "Stop after this many rows" },
      },
      required: ["path"],
    },
  },
  {
    name: "xlsx_to_markdown",
    description:
      "Render a sheet as a Markdown table, treating the first row as the header. Best for showing a " +
      "small sheet to the user; use xlsx_read_sheet when you need to compute over the values.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to the .xlsx" },
        sheet: { type: "string", description: "Sheet name or 1-based index; defaults to the first" },
        max_rows: { type: "number", description: "Stop after this many rows" },
      },
      required: ["path"],
    },
  },
];

const cellText = (v) => (v === null ? "" : String(v)).replace(/\|/g, "\\|");

function callTool(name, args = {}) {
  switch (name) {
    case "xlsx_sheets": {
      const zip = openWorkbook(args.path);
      const strings = sharedStrings(zip);
      const sheets = sheetList(zip).map((s) => {
        const rows = readSheet(zip, s.part, strings);
        return { name: s.name, rows: rows.length, columns: rows[0]?.length ?? 0 };
      });
      return { sheets, count: sheets.length };
    }
    case "xlsx_read_sheet": {
      const zip = openWorkbook(args.path);
      const sheet = pickSheet(sheetList(zip), args.sheet);
      const rows = readSheet(zip, sheet.part, sharedStrings(zip), args.max_rows ?? Infinity);
      return { sheet: sheet.name, rows, row_count: rows.length };
    }
    case "xlsx_to_markdown": {
      const zip = openWorkbook(args.path);
      const sheet = pickSheet(sheetList(zip), args.sheet);
      const rows = readSheet(zip, sheet.part, sharedStrings(zip), args.max_rows ?? Infinity);
      if (rows.length === 0) return { sheet: sheet.name, markdown: "", row_count: 0 };
      const [head, ...body] = rows;
      const lines = [
        `| ${head.map(cellText).join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...body.map((r) => `| ${r.map(cellText).join(" | ")} |`),
      ];
      return { sheet: sheet.name, markdown: lines.join("\n"), row_count: rows.length };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/* ------------------------------------------------------------------ transport */

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const failWith = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return failWith(null, -32700, "invalid JSON"); // no id available, so this cannot be answered
  }
  try {
    switch (msg.method) {
      case "initialize":
        return reply(msg.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "xlsx-tools", version: "1.0.0" },
        });
      case "tools/list":
        return reply(msg.id, { tools: TOOLS });
      case "tools/call": {
        const out = callTool(msg.params?.name, msg.params?.arguments);
        return reply(msg.id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      }
      case "notifications/initialized":
        return; // a notification has no id and takes no reply
      default:
        return failWith(msg.id, -32601, `method not found: ${msg.method}`);
    }
  } catch (e) {
    // Tool failures are reported to the caller, never thrown into the event loop: an uncaught throw
    // kills the server and takes every other pending call with it.
    return failWith(msg.id, -32000, e instanceof Error ? e.message : String(e));
  }
});

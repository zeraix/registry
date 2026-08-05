#!/usr/bin/env node
/**
 * Word (.docx) reader, exposed over MCP stdio.
 *
 * Declared by providers.docx: kind "mcp-stdio", tier "sandboxed", entry "server/index.js". The
 * registry hashes this file and the endpoint pins the digest in the index, so the bytes that run are
 * the bytes that were reviewed.
 *
 * ZERO DEPENDENCIES, deliberately. A sandboxed provider runs inside the microVM with only the
 * filesystem grants the manifest asks for and no network; there is no npm install step and no
 * node_modules to reach. Everything below — ZIP central directory, DEFLATE via node:zlib, and the
 * OOXML shapes — is implemented here so the bundle is exactly what the digest covers.
 *
 * Read-only. It opens documents and returns text; it never writes one.
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

/* ------------------------------------------------------------------ docx */

/**
 * One paragraph, flattened.
 *
 * `w:t` are the text runs, which Word splits at arbitrary points (a spell-check boundary, a tracked
 * change, a font switch), so they must be concatenated before the text means anything. `w:pStyle`
 * names the paragraph style, which is where headings live — there is no heading element in OOXML,
 * only a style called "Heading1".
 */
function paragraph(p) {
  const style = /<w:pStyle[^>]*w:val="([^"]+)"/.exec(p)?.[1] ?? "";
  const heading = /^Heading(\d)$/i.exec(style);
  return {
    kind: "paragraph",
    text: decodeXml(tagTexts(p, "w:t").join("")).trim(),
    level: heading ? Number(heading[1]) : 0,
    listItem: /<w:numPr[\s>]/.test(p),
  };
}

/** One table as rows of cell text. `w:tbl` > `w:tr` > `w:tc`, each cell holding its own paragraphs. */
const table = (tbl) => ({
  kind: "table",
  rows: tagTexts(tbl, "w:tr").map((tr) =>
    tagTexts(tr, "w:tc").map((tc) => decodeXml(tagTexts(tc, "w:t").join("")).trim()),
  ),
});

/**
 * Body content in document order, as paragraphs and tables.
 *
 * Matching `w:p` across the whole document does NOT work: every table cell contains its own
 * paragraphs, so each cell's text comes back a second time as a loose paragraph and the document
 * reads with its tables duplicated — once inline, once as a table. Alternating on `w:tbl` FIRST is
 * what prevents that: at the position where a table begins, the table branch matches the whole
 * element and advances past it, so the paragraphs inside are never visited on their own.
 *
 * Known limit: a table nested inside another table ends at the inner `</w:tbl>`, because the match
 * is non-greedy. Nested tables are rare enough to accept, and the failure is a partial table rather
 * than lost text.
 */
function blocks(documentXml) {
  const re = /<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  const out = [];
  let m;
  while ((m = re.exec(documentXml)) !== null) {
    out.push(m[1] !== undefined ? table(m[1]) : paragraph(m[2]));
  }
  return out;
}

function openDocument(relPath) {
  const abs = resolveInWorkspace(relPath);
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${relPath}`);
  if (path.extname(abs).toLowerCase() !== ".docx") {
    // .doc is the pre-2007 binary format and is not a ZIP at all; saying so beats "not a zip archive".
    throw new Error(`expected a .docx file, got "${path.extname(abs) || "no extension"}"`);
  }
  const xml = readZipEntry(fs.readFileSync(abs), "word/document.xml");
  if (!xml) throw new Error(`${relPath} has no word/document.xml — is it a Word file?`);
  return xml.toString("utf8");
}

/* ------------------------------------------------------------------ tools */

const TOOLS = [
  {
    name: "docx_to_markdown",
    description:
      "Read a Word .docx and return its content as Markdown, preserving heading levels, paragraphs, " +
      "list items and tables. Use this to read a Word document before answering questions about it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to the .docx" },
        include_tables: { type: "boolean", description: "Render tables as Markdown tables (default true)" },
      },
      required: ["path"],
    },
  },
  {
    name: "docx_outline",
    description:
      "Return just the heading structure of a Word .docx as a nested outline, without the body text. " +
      "Much cheaper than reading the whole document when you only need to find the relevant section.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative path to the .docx" } },
      required: ["path"],
    },
  },
  {
    name: "docx_tables",
    description:
      "Extract every table from a Word .docx as structured rows, so figures can be read exactly " +
      "rather than inferred from rendered text.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative path to the .docx" } },
      required: ["path"],
    },
  },
];

const mdEscape = (s) => s.replace(/\|/g, "\\|");

function toMarkdown(xml, { includeTables = true } = {}) {
  const lines = [];
  let inList = false;
  // A run of list items is only closed by a blank line. Without this, the item before a heading and
  // the heading itself end up on adjacent lines and the heading stops being a heading.
  const endList = () => {
    if (inList) lines.push("");
    inList = false;
  };

  for (const b of blocks(xml)) {
    if (b.kind === "table") {
      if (!includeTables || b.rows.length === 0) continue;
      endList();
      const [head, ...body] = b.rows;
      lines.push(`| ${head.map(mdEscape).join(" | ")} |`);
      lines.push(`| ${head.map(() => "---").join(" | ")} |`);
      for (const r of body) lines.push(`| ${r.map(mdEscape).join(" | ")} |`);
      lines.push("");
      continue;
    }
    if (!b.text) continue;
    if (b.level > 0) {
      endList();
      lines.push(`${"#".repeat(Math.min(b.level, 6))} ${b.text}`, "");
    } else if (b.listItem) {
      lines.push(`- ${b.text}`);
      inList = true;
    } else {
      endList();
      lines.push(b.text, "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function callTool(name, args = {}) {
  switch (name) {
    case "docx_to_markdown": {
      const xml = openDocument(args.path);
      const markdown = toMarkdown(xml, { includeTables: args.include_tables !== false });
      return { markdown, characters: markdown.length };
    }
    case "docx_outline": {
      const outline = blocks(openDocument(args.path))
        .filter((b) => b.kind === "paragraph" && b.level > 0 && b.text)
        .map((b) => ({ level: b.level, text: b.text }));
      return { outline, headings: outline.length };
    }
    case "docx_tables": {
      const found = blocks(openDocument(args.path))
        .filter((b) => b.kind === "table" && b.rows.length > 0)
        .map((b) => b.rows);
      return { tables: found, count: found.length };
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
          serverInfo: { name: "docx-tools", version: "1.0.0" },
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

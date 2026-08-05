#!/usr/bin/env node
/**
 * PowerPoint (.pptx) reader, exposed over MCP stdio.
 *
 * Declared by providers.pptx: kind "mcp-stdio", tier "sandboxed", entry "server/index.js". The
 * registry hashes this file and the endpoint pins the digest in the index, so the bytes that run are
 * the bytes that were reviewed.
 *
 * ZERO DEPENDENCIES, deliberately. A sandboxed provider runs inside the microVM with only the
 * filesystem grants the manifest asks for and no network; there is no npm install step and no
 * node_modules to reach. Everything below -- ZIP central directory, DEFLATE via node:zlib, and the
 * OOXML shapes -- is implemented here so the bundle is exactly what the digest covers.
 *
 * Read-only. It opens .pptx files and returns their content; it never writes one.
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

/* ------------------------------------------------------------------ pptx */

/** Slide parts in deck order. Names are ppt/slides/slideN.xml, and N is not zero-padded. */
function slideParts(zip) {
  return listZipEntries(zip)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
}

/**
 * One slide, as title plus body paragraphs.
 *
 * A slide is a tree of `p:sp` shapes. Which one is the title is DECLARED, by a placeholder
 * `<p:ph type="title"/>` or "ctrTitle" -- position on screen says nothing, and shape order is
 * authoring order rather than reading order, so picking "the first shape" gets it wrong on any deck
 * where the author moved things around.
 *
 * Text sits in `a:p` paragraphs of `a:t` runs, split at arbitrary points exactly as in Word, and
 * `lvl` on the paragraph properties carries a bullet's outline depth.
 */
function readSlide(zip, part) {
  const xml = readZipEntry(zip, part)?.toString("utf8") ?? "";
  let title = "";
  const body = [];

  for (const sp of tagTexts(xml, "p:sp")) {
    const isTitle = /<p:ph\b[^>]*\btype="(?:ctrTitle|title)"/.test(sp);
    const paras = tagTexts(sp, "a:p").map((p) => ({
      text: decodeXml(tagTexts(p, "a:t").join("")).trim(),
      level: Number(/<a:pPr\b[^>]*\blvl="(\d+)"/.exec(p)?.[1] ?? 0),
    }));
    if (isTitle && !title) {
      title = paras.map((p) => p.text).filter(Boolean).join(" ").trim();
      continue;
    }
    for (const p of paras) if (p.text) body.push(p);
  }
  return { title, body };
}

/**
 * Speaker notes for slide N, if the deck has any.
 *
 * The notes part repeats the slide's own text in a placeholder shape, so the slide-number and body
 * placeholders are dropped -- otherwise every note comes back with the slide duplicated inside it.
 */
function readNotes(zip, index) {
  const xml = readZipEntry(zip, `ppt/notesSlides/notesSlide${index + 1}.xml`)?.toString("utf8");
  if (!xml) return "";
  return tagTexts(xml, "p:sp")
    .filter((sp) => !/<p:ph\b[^>]*\btype="(?:sldNum|sldImg)"/.test(sp))
    .flatMap((sp) => tagTexts(sp, "a:p").map((p) => decodeXml(tagTexts(p, "a:t").join("")).trim()))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function openDeck(relPath) {
  const abs = resolveInWorkspace(relPath);
  if (!fs.existsSync(abs)) throw new Error(`no such file: ${relPath}`);
  const ext = path.extname(abs).toLowerCase();
  if (ext !== ".pptx") {
    // .ppt is the pre-2007 binary format and is not a ZIP at all; saying so beats "not a zip archive".
    throw new Error(`expected a .pptx file, got "${ext || "no extension"}"`);
  }
  const zip = fs.readFileSync(abs);
  const parts = slideParts(zip);
  if (parts.length === 0) throw new Error(`${relPath} has no slides -- is it a PowerPoint file?`);
  return { zip, parts };
}

/* ------------------------------------------------------------------ tools */

const TOOLS = [
  {
    name: "pptx_to_markdown",
    description:
      "Read a PowerPoint .pptx and return the whole deck as Markdown -- one section per slide, with " +
      "its title as a heading and its body text as nested bullets. Use this to read a deck before " +
      "answering questions about it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to the .pptx" },
        include_notes: { type: "boolean", description: "Append each slide's speaker notes (default false)" },
      },
      required: ["path"],
    },
  },
  {
    name: "pptx_outline",
    description:
      "Return just the slide titles, numbered. Much cheaper than reading the whole deck when you " +
      "only need to find the relevant slide.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative path to the .pptx" } },
      required: ["path"],
    },
  },
  {
    name: "pptx_notes",
    description:
      "Extract the speaker notes for every slide. Notes usually carry the argument the slide only " +
      "gestures at, so they are often the most informative part of a deck.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative path to the .pptx" } },
      required: ["path"],
    },
  },
];

function callTool(name, args = {}) {
  switch (name) {
    case "pptx_to_markdown": {
      const { zip, parts } = openDeck(args.path);
      const lines = [];
      parts.forEach((part, i) => {
        const slide = readSlide(zip, part);
        lines.push(`## Slide ${i + 1}${slide.title ? `: ${slide.title}` : ""}`, "");
        for (const p of slide.body) lines.push(`${"  ".repeat(p.level)}- ${p.text}`);
        if (slide.body.length) lines.push("");
        if (args.include_notes) {
          const notes = readNotes(zip, i);
          if (notes) lines.push(`> **Notes:** ${notes.replace(/\n/g, "\n> ")}`, "");
        }
      });
      const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      return { markdown, slides: parts.length };
    }
    case "pptx_outline": {
      const { zip, parts } = openDeck(args.path);
      const outline = parts.map((part, i) => ({ slide: i + 1, title: readSlide(zip, part).title }));
      return { outline, slides: outline.length };
    }
    case "pptx_notes": {
      const { zip, parts } = openDeck(args.path);
      const notes = parts.map((_, i) => ({ slide: i + 1, notes: readNotes(zip, i) })).filter((n) => n.notes);
      return { notes, slides_with_notes: notes.length };
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
          serverInfo: { name: "pptx-tools", version: "1.0.0" },
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

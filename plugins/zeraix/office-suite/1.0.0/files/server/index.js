#!/usr/bin/env node
/**
 * Office document MCP server (stdio).
 *
 * Declared by providers.docs: kind "mcp-stdio", tier "sandboxed", runtime "node",
 * entry "server/index.js". The registry hashes this file and pins the digest in the
 * index, so the bytes that run are the bytes that were reviewed.
 *
 * Sandboxed tier means this executes inside the microVM with only the filesystem
 * grants the manifest asks for ($WORKSPACE and $TMP/office) and no network at all.
 * Every path below is resolved against those roots; a request that escapes them is
 * refused here as well, because a sandbox is a backstop and not an excuse.
 *
 * This is scaffolding. It implements the three tools it declares against a stub
 * document layer rather than a real .docx/.xlsx parser — the point is the shape of
 * a compliant stdio server, not the file format work.
 */
import { createInterface } from "node:readline";
import path from "node:path";

const WORKSPACE = process.env.ZERAIX_WORKSPACE ?? process.cwd();

const TOOLS = [
  {
    name: "docx_extract",
    description: "Read a .docx and return its text with heading structure preserved.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative path to the .docx" } },
      required: ["path"],
    },
  },
  {
    name: "docx_write",
    description: "Create or update a .docx from Markdown, keeping the template's named styles.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative destination" },
        markdown: { type: "string", description: "Document body as Markdown" },
        template: { type: "string", description: "Optional template id from the gallery" },
      },
      required: ["path", "markdown"],
    },
  },
  {
    name: "xlsx_query",
    description: "Run a SQL-like query over a sheet and return the matching rows.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to the .xlsx" },
        sheet: { type: "string", description: "Sheet name; defaults to the first" },
        query: { type: "string", description: "e.g. SELECT region, total WHERE total > 1000" },
      },
      required: ["path", "query"],
    },
  },
];

/**
 * Resolve a caller-supplied path inside the workspace.
 *
 * The check is on the RESOLVED path, not the input string: "a/../../etc/passwd" only
 * reveals itself as an escape after resolution, and blocklisting ".." in the raw
 * string misses every encoding of it.
 */
function resolveInWorkspace(relPath) {
  if (typeof relPath !== "string" || !relPath) throw new Error("path is required");
  const abs = path.resolve(WORKSPACE, relPath);
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) {
    throw new Error(`path escapes the workspace: ${relPath}`);
  }
  return abs;
}

function callTool(name, args = {}) {
  switch (name) {
    case "docx_extract": {
      const file = resolveInWorkspace(args.path);
      return { headings: [], text: "", source: path.relative(WORKSPACE, file) };
    }
    case "docx_write": {
      const file = resolveInWorkspace(args.path);
      if (typeof args.markdown !== "string") throw new Error("markdown is required");
      return { written: path.relative(WORKSPACE, file), bytes: Buffer.byteLength(args.markdown) };
    }
    case "xlsx_query": {
      const file = resolveInWorkspace(args.path);
      if (typeof args.query !== "string" || !args.query.trim()) throw new Error("query is required");
      return { columns: [], rows: [], source: path.relative(WORKSPACE, file) };
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
    // No id available, so this cannot be answered as a request. -32700 is parse error.
    return failWith(null, -32700, "invalid JSON");
  }

  try {
    switch (msg.method) {
      case "initialize":
        return reply(msg.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "office-suite", version: "1.0.0" },
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
    // Tool failures are reported to the caller, never thrown into the event loop: an
    // uncaught throw here kills the server and takes every other pending call with it.
    return failWith(msg.id, -32000, e instanceof Error ? e.message : String(e));
  }
});

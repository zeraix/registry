#!/usr/bin/env node
/**
 * Assemble the two client feeds from the committed tree into dist/plugins/.
 *
 *   node .github/scripts/build-feeds.mjs --root . --app .app
 *     [--out dist] [--base-url URL] [--sequence N] [--include-generated] [--allow-uncommitted]
 *
 * Until the publish endpoint exists (design doc §5.2), this repository IS the origin: the app's
 * NEXT_PUBLIC_PLUGIN_ORIGIN points at raw.githubusercontent.com/zeraix/registry/main/dist, which can
 * only serve committed bytes. So dist/ is committed, and the publish workflow rebuilds and commits it
 * on every merge. When the endpoint lands, this script is what feeds it and dist/ stops being tracked.
 *
 * What it owes the client is the four things nothing else can supply (publish.yml lists them):
 * sha512 per artifact computed from the bytes, one document embedding every manifest, a monotonic
 * sequence, and https artifact URLs.
 *
 * The manifests written here are validateManifest's NORMALISED output in `client` mode -- the exact
 * shape feed.mjs will re-validate on the other end. Building from the raw plugin.json instead would
 * publish fields the client drops, and the catalogue would describe something subtly different from
 * what installs.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { collectPluginDirs, unreferencedFiles, withDigests } from "./lib/plugins.mjs";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const root = path.resolve(arg("root", "."));
const appDir = path.resolve(arg("app", ".app"));
const outDir = path.resolve(arg("out", path.join(root, "dist")));
const includeGenerated = flag("include-generated");
// For a future publish endpoint, which receives the bytes directly instead of serving them from git.
const allowUncommitted = flag("allow-uncommitted");
const DEFAULT_BASE_URL = "https://raw.githubusercontent.com/zeraix/registry/main/plugins";
const baseUrlRoot = (arg("base-url", DEFAULT_BASE_URL) ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

const validatorPath = path.join(appDir, "electron", "plugins", "manifest.mjs");
if (!fs.existsSync(validatorPath)) {
  console.error(`::error::no validator at ${validatorPath} — the app checkout is missing.`);
  console.error(`::error::A feed built without one would embed manifests no client has agreed to accept.`);
  process.exit(1);
}
const { validateManifest } = await import(`file://${validatorPath.replace(/\\/g, "/")}`);

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/**
 * Plugins the repository holds but does not offer. Today that is the OAuth template, which exists to
 * be copied, not installed -- a user browsing the marketplace would find an entry that does nothing
 * for them. Kept as data rather than a condition in the code so adding one is a one-line diff a
 * reviewer can see.
 */
const unlisted = new Map(
  (readJson(path.join(root, "unlisted.json"), { entries: [] })?.entries ?? []).map((e) => [e.id, e.reason ?? ""]),
);

/**
 * Which plugin directories are generated rather than committed.
 *
 * The built-in skills are materialized into plugins/zeraix/ by the publish workflow and gitignored
 * (see plugins/zeraix/.gitignore), so "tracked by git" separates them from the hand-authored official
 * plugins beside them with no second list to maintain. They are held back from the catalogue because
 * the app already ships all ten built in; listing them would offer users an install for something
 * they have. --include-generated is the flip for when the marketplace replaces the built-in set
 * (design doc §9 phase 1) -- one flag, no rewrite.
 *
 * If git cannot answer (a tarball, no repo), nothing is treated as generated and the run says so:
 * silently publishing ten unexpected entries is worse than publishing none.
 */
function trackedPluginFiles() {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "plugins"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return new Set(out.split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/")));
  } catch {
    return null;
  }
}
const tracked = trackedPluginFiles();

/**
 * Paths whose working-tree bytes differ from what git holds. Modified, staged or untracked -- the
 * cause does not matter, only that the two disagree.
 */
function dirtyPluginFiles() {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain", "--", "plugins"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(
      out
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3).trim().replace(/^"|"$/g, "").replace(/\\/g, "/")),
    );
  } catch {
    return null;
  }
}
const dirty = allowUncommitted ? null : dirtyPluginFiles();

/**
 * The bytes hashed here MUST be the bytes the origin will serve, and today the origin is
 * raw.githubusercontent.com serving `main` -- i.e. the COMMITTED blob, never the working tree.
 *
 * This is not theoretical. On a Windows checkout the working tree is CRLF and the committed blob is
 * LF, so skill.md hashes to a different digest in each: 1333 bytes against 1307. A feed built from
 * the working tree would pin a digest no client can ever reproduce, and store.mjs would reject every
 * download as tampered -- on the user's machine, long after review, with an integrity error rather
 * than a useful one. Checking "committed and unmodified" catches that and every other way the two
 * can diverge, including the ordinary one of forgetting to commit an edited artifact.
 */
function servedByGit(relPath, at) {
  if (!tracked || !dirty) return null;
  if (!tracked.has(relPath)) return `${at}: files/ artifact ${relPath} is not committed, so the origin cannot serve it`;
  if (dirty.has(relPath)) {
    return (
      `${at}: ${relPath} differs from the committed blob, so its digest would pin bytes no client can fetch. ` +
      `On Windows this is usually CRLF in the working tree — commit the file, or build from a clean checkout.`
    );
  }
  return null;
}
if (!tracked && !includeGenerated) {
  console.log("::warning::git could not list tracked files — treating every plugin directory as committed.");
}

/* ------------------------------------------------------------------ build */

const problems = [];
const entries = [];
const omitted = [];

for (const entry of collectPluginDirs(root)) {
  const at = `plugins/${entry.publisher}/${entry.name}/${entry.version}`;
  const id = `${entry.publisher}/${entry.name}`;

  if (unlisted.has(id)) {
    omitted.push(`${id} — unlisted.json: ${unlisted.get(id) || "no reason given"}`);
    continue;
  }
  const relManifest = `${path.relative(root, entry.dir).replace(/\\/g, "/")}/plugin.json`;
  if (!includeGenerated && tracked && !tracked.has(relManifest)) {
    omitted.push(`${id} — generated, not committed (--include-generated to publish it)`);
    continue;
  }

  const source = readJson(path.join(entry.dir, "plugin.json"));
  if (!source) {
    problems.push(`${at}/plugin.json: unreadable or not JSON`);
    continue;
  }

  const filesDir = path.join(entry.dir, "files");
  const resolved = withDigests(source, filesDir);
  if (resolved.problems.length > 0) {
    resolved.problems.forEach((p) => problems.push(`${at}: ${p}`));
    continue;
  }

  const relFiles = path.relative(root, filesDir).replace(/\\/g, "/");
  const unservable = [...resolved.referenced]
    .map((f) => servedByGit(`${relFiles}/${f.replace(/\\/g, "/")}`, at))
    .filter(Boolean);
  if (unservable.length > 0) {
    unservable.forEach((p) => problems.push(p));
    continue;
  }

  // `client` mode, not `registry`: this is the check the app itself will apply to these bytes when
  // feed.mjs parses them. Passing review is not the bar here -- being installable is.
  const result = validateManifest(resolved.manifest, { mode: "client" });
  if (!result.ok) {
    result.errors.forEach((e) => problems.push(`${at}: ${e}`));
    continue;
  }
  if (result.manifest.id !== id || result.manifest.version !== entry.version) {
    problems.push(`${at}: manifest identifies as ${result.manifest.id}@${result.manifest.version}`);
    continue;
  }

  unreferencedFiles(filesDir, resolved.referenced).forEach((f) =>
    console.log(`::warning::${at}: files/${f} is not referenced by the manifest and ships to nobody`),
  );

  entries.push({
    manifest: result.manifest,
    dist: { baseUrl: `${baseUrlRoot}/${entry.publisher}/${entry.name}/${entry.version}/files/` },
  });
}

if (problems.length > 0) {
  for (const p of problems) console.log(`::error::${p}`);
  console.error(`\n${problems.length} problem(s) — no feed was written.`);
  process.exit(1);
}

/* --------------------------------------------------------------- sequence */

/**
 * The sequence must CLIMB, and the previous value is the only safe thing to derive it from.
 *
 * Clients refuse any feed whose sequence is below the one they already hold (feed.mjs), which is what
 * stops a cached kill-list being replayed to un-revoke a plugin. The published feeds currently sit at
 * ~1.78e9 -- seconds, from whenever dist/ was first hand-built -- so anything counter-shaped, a CI run
 * number above all, is FAR below that and would be refused by every client that has ever refreshed,
 * permanently and silently. Since dist/ is committed there is always a previous value to count from.
 */
const previous = Math.max(
  readJson(path.join(outDir, "plugins", "index.json"), {})?.sequence ?? -1,
  readJson(path.join(outDir, "plugins", "killlist.json"), {})?.sequence ?? -1,
);
const requested = arg("sequence");
let sequence;
if (requested !== null) {
  sequence = Number(requested);
  if (!Number.isInteger(sequence) || sequence < 0) {
    console.error(`::error::--sequence must be a non-negative integer, got "${requested}"`);
    process.exit(1);
  }
  if (sequence <= previous) {
    console.error(`::error::--sequence ${sequence} is not above the published ${previous}. Every client that`);
    console.error(`::error::has refreshed would refuse this feed as a rollback, and keep refusing it.`);
    process.exit(1);
  }
} else {
  sequence = previous + 1;
}

const issuedAt = new Date().toISOString();
const unchanged = [];

/** Everything a feed says other than when it was built. Two feeds equal by this say the same thing. */
const substance = ({ sequence: _s, issuedAt: _i, ...rest }) => JSON.stringify(rest);

/**
 * Write a feed, unless it would say exactly what the published one already says.
 *
 * A rebuild runs on every merge, most of which touch no plugin. Without this the sequence climbs and
 * a commit lands on main each time, both for a catalogue nobody changed -- and the sequence is not a
 * free counter: it is the anti-rollback floor every client stores, so inflating it on no news spends
 * the one number that protects them. The two feeds are compared independently because they carry
 * independent sequences (feed.mjs tracks one per feed name).
 */
const write = (name, payload) => {
  const file = path.join(outDir, "plugins", `${name}.json`);
  const published = readJson(file);
  if (published && substance(published) === substance(payload)) {
    unchanged.push(name);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // LF and a trailing newline: these are committed files, and a byte-level diff on every rebuild
  // would bury the one line that actually changed.
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

write("index", { type: "index", sequence, issuedAt, plugins: entries });
write("killlist", {
  type: "killlist",
  sequence,
  issuedAt,
  entries: readJson(path.join(root, "killlist.json"), { entries: [] })?.entries ?? [],
});

if (unchanged.length === 2) {
  console.log(`no change: both feeds already say this, left at sequence ${previous}.`);
  process.exit(0);
}
for (const name of unchanged) console.log(`unchanged: ${name}.json left at sequence ${previous}`);
console.log(`sequence ${previous} -> ${sequence}, issued ${issuedAt}`);
for (const e of entries) console.log(`  published: ${e.manifest.id}@${e.manifest.version}`);
// Never silent about what was left out: a catalogue that quietly drops an entry reads as complete.
for (const o of omitted) console.log(`  omitted:   ${o}`);
console.log(`\n${entries.length} plugin(s) in the catalogue, ${omitted.length} omitted.`);

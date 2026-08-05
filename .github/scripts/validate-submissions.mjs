#!/usr/bin/env node
/**
 * Validate every plugin committed to this repository. Checks only -- writes nothing.
 *
 * There is no build step in this registry. A plugin is a committed directory; adding one is a pull
 * request and removing one is an entry in killlist.json. Assembling the catalogue (hashing the
 * artifacts, embedding the manifests, assigning the feed sequence) is the publish endpoint's job,
 * not CI's. This script exists for one purpose: to fail a pull request whose manifest a client would
 * reject or silently skip, while a human is still looking at it.
 *
 * That matters more than it sounds. Feeds are no longer signed (design doc §5.1), so review is the
 * only gate between a submission and every install, and this is what makes review mean something
 * beyond reading the diff.
 *
 * The VALIDATOR itself is not defined here -- it is `validateManifest` from the app repo, checked
 * out at .app by the workflow. Vendoring a copy would let the two drift, and then "CI passed" would
 * stop meaning "clients will accept this", which is the entire value of validating at review time.
 *
 *   node .github/scripts/validate-submissions.mjs --root . [--allow-reserved] [--app .app]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const root = path.resolve(arg("root", "."));
const appDir = path.resolve(arg("app", ".app"));
const allowReserved = flag("allow-reserved");

const validatorPath = path.join(appDir, "electron", "plugins", "manifest.mjs");
if (!fs.existsSync(validatorPath)) {
  console.error(`::error::no validator at ${validatorPath} — the app checkout is missing or predates the plugin schema.`);
  process.exit(1);
}
const { validateManifest, RESERVED_PUBLISHERS } = await import(`file://${validatorPath.replace(/\\/g, "/")}`);

const sha512 = (buf) => crypto.createHash("sha512").update(buf).digest("base64");

/** Every `<publisher>/<name>/<version>/plugin.json` under `<root>/plugins`, sorted. */
function collectPluginDirs(base) {
  const dirs = (p) => {
    try {
      return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  };
  const out = [];
  const pluginsRoot = path.join(base, "plugins");
  for (const publisher of dirs(pluginsRoot)) {
    for (const name of dirs(path.join(pluginsRoot, publisher))) {
      for (const version of dirs(path.join(pluginsRoot, publisher, name))) {
        const dir = path.join(pluginsRoot, publisher, name, version);
        if (fs.existsSync(path.join(dir, "plugin.json"))) out.push({ publisher, name, version, dir });
      }
    }
  }
  return out;
}

/**
 * Fill in `sha512` for everything the manifest references, from the bytes on disk.
 *
 * Submissions omit the digests on purpose -- a hand-written base64 sha512 is a transcription error
 * waiting to break an install for everyone -- but `validateManifest` requires them on content
 * capabilities. So they are computed here IN MEMORY purely so the validator has something to check.
 * Nothing is written, and this is not the digest anyone ships: the publish endpoint computes the
 * authoritative one from the same bytes when it assembles the index.
 *
 * It is also where a manifest referencing a file that does not exist gets caught, which would
 * otherwise publish an entry every user can see and no user can install.
 */
function withDigests(source, filesDir) {
  const problems = [];
  const manifest = structuredClone(source);
  const referenced = new Set();

  const hashOf = (relPath, at) => {
    if (typeof relPath !== "string" || !relPath) {
      problems.push(`${at}: path must be a string`);
      return null;
    }
    const abs = path.join(filesDir, relPath);
    if (!abs.startsWith(filesDir + path.sep)) {
      problems.push(`${at}: "${relPath}" escapes files/`);
      return null;
    }
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      problems.push(`${at}: files/${relPath} does not exist`);
      return null;
    }
    referenced.add(path.relative(filesDir, abs));
    return sha512(buf);
  };

  for (const [i, cap] of (manifest.capabilities ?? []).entries()) {
    if (!cap || typeof cap !== "object" || !("path" in cap)) continue;
    const digest = hashOf(cap.path, `capabilities[${i}]`);
    if (!digest) continue;
    // A declared digest that disagrees with the bytes means the manifest and the artifact came from
    // different builds, and one of them is not what the submitter reviewed.
    if (typeof cap.sha512 === "string" && cap.sha512 !== digest) {
      problems.push(`capabilities[${i}]: declared sha512 does not match files/${cap.path}`);
    }
    cap.sha512 = digest;
  }
  for (const [id, provider] of Object.entries(manifest.providers ?? {})) {
    if (!provider || typeof provider !== "object" || !provider.entry) continue;
    const digest = hashOf(provider.entry, `providers.${id}`);
    if (!digest) continue;
    if (typeof provider.sha512 === "string" && provider.sha512 !== digest) {
      problems.push(`providers.${id}: declared sha512 does not match files/${provider.entry}`);
    }
    provider.sha512 = digest;
  }

  return { manifest, problems, referenced };
}

/** Files present in files/ that nothing references. Dead weight, usually a rename someone missed. */
function unreferencedFiles(filesDir, referenced) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (!referenced.has(path.relative(filesDir, abs))) out.push(path.relative(filesDir, abs));
    }
  };
  walk(filesDir);
  return out;
}

/* ------------------------------------------------------------------ run */

const problems = [];
const warnings = [];
const seen = new Map();
let checked = 0;

for (const entry of collectPluginDirs(root)) {
  const at = `plugins/${entry.publisher}/${entry.name}/${entry.version}`;

  // Reserved namespaces mean "official", and the consent sheet says so. Only builds allowed to speak
  // for us pass --allow-reserved: the publish workflow, and pull requests raised from this repo. A
  // fork cannot set it.
  if (!allowReserved && RESERVED_PUBLISHERS.includes(entry.publisher)) {
    problems.push(`${at}: "${entry.publisher}" is a reserved publisher — a submission may not claim it.`);
    continue;
  }

  let source;
  try {
    source = JSON.parse(fs.readFileSync(path.join(entry.dir, "plugin.json"), "utf8"));
  } catch (e) {
    problems.push(`${at}/plugin.json: ${e.message}`);
    continue;
  }

  const filesDir = path.join(entry.dir, "files");
  const resolved = withDigests(source, filesDir);
  resolved.problems.forEach((p) => problems.push(`${at}: ${p}`));
  if (resolved.problems.length > 0) continue;

  // Strict mode: anything a client would silently skip is an error at review time.
  const result = validateManifest(resolved.manifest, { mode: "registry" });
  result.warnings.forEach((w) => warnings.push(`${at}: ${w}`));
  if (!result.ok) {
    result.errors.forEach((e) => problems.push(`${at}: ${e}`));
    continue;
  }

  // The directory is the source of truth for identity: a manifest claiming a different id or version
  // than its path would publish under one name and install under another.
  const expectedId = `${entry.publisher}/${entry.name}`;
  if (result.manifest.id !== expectedId) {
    problems.push(`${at}: manifest id "${result.manifest.id}" does not match its directory (${expectedId})`);
    continue;
  }
  if (result.manifest.version !== entry.version) {
    problems.push(`${at}: manifest version "${result.manifest.version}" does not match its directory`);
    continue;
  }

  // One version per plugin: the client installs "the" version of an id, so two would make which one
  // a user gets depend on the order the endpoint happened to walk the tree in.
  const previous = seen.get(expectedId);
  if (previous) {
    problems.push(`${expectedId}: published twice (${previous} and ${entry.version}) — remove the older directory`);
  } else {
    seen.set(expectedId, entry.version);
  }

  unreferencedFiles(filesDir, resolved.referenced).forEach((f) => warnings.push(`${at}: files/${f} is not referenced`));
  checked += 1;
}

for (const w of warnings) console.log(`::warning::${w}`);
for (const p of problems) console.log(`::error::${p}`);

/**
 * Also write the outcome to the run summary.
 *
 * Annotations scroll away and are easy to miss on a green run, which is exactly when the result
 * matters most here: this workflow can pass having done nothing but check, and a reader who sees
 * only the tick will assume the marketplace changed. The summary is the one surface that survives
 * on the run page.
 */
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines =
    problems.length > 0
      ? [`### ❌ ${problems.length} problem(s) — nothing is publishable`, "", ...problems.map((p) => `- ${p}`)]
      : [`### ✅ ${checked} plugin(s) validated`];
  if (warnings.length > 0) {
    lines.push(
      "",
      `<details><summary>${warnings.length} warning(s) — reserved capability types and provider kinds not yet implemented</summary>`,
      "",
      ...warnings.map((w) => `- ${w}`),
      "",
      "</details>",
    );
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n\n`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`ok: ${checked} plugin(s) validated, ${warnings.length} warning(s).`);

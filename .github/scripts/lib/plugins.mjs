/**
 * Reading the committed plugin tree: directory walk, artifact digests, orphan detection.
 *
 * Extracted because two scripts now read this tree and they must read it IDENTICALLY.
 * validate-submissions.mjs decides what may be published; build-feeds.mjs decides what IS published.
 * A second copy of "which directories are plugins" or "how a digest is computed" would eventually
 * disagree, and the failure that produces is the nastiest one this repo can have: a green review on
 * bytes that are not the bytes the catalogue ships. One implementation, two callers.
 *
 * Nothing here writes. The digests are computed in memory; whether they end up in a feed is the
 * caller's business.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const sha512 = (buf) => crypto.createHash("sha512").update(buf).digest("base64");

/** Every `<publisher>/<name>/<version>/plugin.json` under `<base>/plugins`, sorted. */
export function collectPluginDirs(base) {
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
 * waiting to break an install for everyone -- so they are computed from the artifacts themselves.
 * `validateManifest` requires them on content capabilities, and store.mjs verifies against them
 * before writing anything to a user's disk, which is what makes an artifact URL safe to trust.
 *
 * It is also where a manifest referencing a file that does not exist gets caught, which would
 * otherwise publish an entry every user can see and no user can install.
 */
export function withDigests(source, filesDir) {
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
export function unreferencedFiles(filesDir, referenced) {
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

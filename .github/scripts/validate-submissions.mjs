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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { collectPluginDirs, unreferencedFiles, withDigests } from "./lib/plugins.mjs";

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
const validator = await import(`file://${validatorPath.replace(/\\/g, "/")}`);
const { validateManifest, RESERVED_PUBLISHERS } = validator;

/**
 * Identify the borrowed validator in the log.
 *
 * Without this, every failure is ambiguous between "this manifest is wrong" and "the validator is
 * older than this manifest", and the two are indistinguishable from the annotations: a stale
 * validator rejects a correct submission with per-field errors that blame the plugin. The workflow
 * tracks `main` deliberately, so skew is expected during a two-repo rollout -- schema changes land in
 * the app repo first -- and it needs to be visible rather than deduced.
 *
 * SCHEMA_VERSION alone cannot carry this: additive changes ship as optional fields and cost no bump
 * (see the app's manifest.mjs header), so a validator can be months behind at the same version. The
 * vocabulary is what actually differs, so the vocabulary is what gets printed.
 */
function validatorIdentity() {
  let rev = "unknown revision";
  try {
    rev = execFileSync("git", ["-C", appDir, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // A checkout without .git (a tarball, or a local --app pointing at a plain directory) is fine;
    // the vocabulary below is the part that matters.
  }
  return {
    rev,
    schemaVersion: validator.SCHEMA_VERSION ?? "unknown",
    providerKinds: validator.PROVIDER_KINDS ?? [],
    capabilityTypes: validator.CAPABILITY_TYPES ?? [],
  };
}

const identity = validatorIdentity();
console.log(
  `validator: zeraix/zeraix@${identity.rev} schemaVersion=${identity.schemaVersion}\n` +
    `  provider kinds:   ${identity.providerKinds.join(", ") || "(not exported)"}\n` +
    `  capability types: ${identity.capabilityTypes.join(", ") || "(not exported)"}`,
);

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

/**
 * Does this rejection look like the validator not knowing a word, rather than the manifest being wrong?
 *
 * These are the shapes a stale validator produces: it meets a kind, type or enum value added after it
 * was written, and reports it as an invalid field. The manifest is fine; the vocabulary is old. Matched
 * loosely on purpose -- the consequence of a false positive is one extra paragraph of log next to an
 * error that is already failing the run, and the consequence of a false negative is the debugging
 * session this exists to prevent.
 */
const SKEW_SHAPED = [
  /unknown (provider kind|capability type)/i,
  /must be one of/i,
  /must be "[^"]+"(, "[^"]+")* or "[^"]+"/i,
  /is newer than this client supports/i,
];
const skewSuspects = problems.filter((p) => SKEW_SHAPED.some((re) => re.test(p)));

for (const w of warnings) console.log(`::warning::${w}`);
for (const p of problems) console.log(`::error::${p}`);

/**
 * When the failures look like skew, say so ONCE, loudly, with the vocabulary that was actually used.
 *
 * Deliberately not a pass: a submission is still rejected. Feeds are unsigned, so review is the only
 * gate, and relaxing it because the cause *might* be skew would turn a red run into a green one on a
 * guess. This changes what the reader is told, not what is allowed -- and the cascade is why it
 * matters: one unknown field on a provider drops that provider, and every `auth` reference to it then
 * reports as a dangling reference, so a single skewed word can present as several unrelated errors.
 */
if (skewSuspects.length > 0) {
  const note = [
    `${skewSuspects.length} of ${problems.length} problem(s) name a field value the validator did not recognise.`,
    `That is what a CORRECT submission looks like when the borrowed validator is older than the schema it targets.`,
    `Validator in use: zeraix/zeraix@${identity.rev} (branch main), schemaVersion ${identity.schemaVersion}.`,
    `It knows these provider kinds: ${identity.providerKinds.join(", ") || "(not exported)"}.`,
    `Additive schema changes do not bump schemaVersion, so a matching version does NOT mean a matching vocabulary.`,
    `If the submission is right, land the schema change on zeraix/zeraix main and re-run this job — no plugin edit is needed.`,
  ];
  for (const line of note) console.log(`::error::${line}`);
}

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
      ? [
          `### ❌ ${problems.length} problem(s) — nothing is publishable`,
          "",
          ...problems.map((p) => `- ${p}`),
          ...(skewSuspects.length > 0
            ? [
                "",
                `> **${skewSuspects.length} of these name an unrecognised field value.** That is what a correct`,
                `> submission looks like against a stale validator. In use: \`zeraix/zeraix@${identity.rev}\``,
                `> (branch \`main\`), schemaVersion ${identity.schemaVersion}, provider kinds:`,
                `> \`${identity.providerKinds.join("`, `") || "(not exported)"}\`.`,
                `> Additive changes do not bump schemaVersion, so a matching version is not a matching vocabulary.`,
                `> If the submission is right, land the schema change on \`zeraix/zeraix\` main and re-run.`,
              ]
            : []),
        ]
      : [
          `### ✅ ${checked} plugin(s) validated`,
          "",
          `<sub>validator: \`zeraix/zeraix@${identity.rev}\` · schemaVersion ${identity.schemaVersion}</sub>`,
        ];
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

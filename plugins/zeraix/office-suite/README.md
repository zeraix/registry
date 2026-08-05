# zeraix/office-suite

The official office plugin: read, write and convert Word, Excel and PowerPoint files, extract text
from scanned documents, and draft in your organisation's house style.

It is also the **reference manifest**. It exercises every structure the schema defines — all six
provider kinds, all nine capability types, all three ways a capability can be bound — so a submitter
can copy the shape from a real plugin rather than assembling it from the spec. If you are writing
your own, read [Structures](#structures) and ignore the rest.

## Status

Stated plainly, because the manifest declares considerably more than the app currently runs:

| Part | State |
|---|---|
| `office_formatting`, `meeting_minutes`, `doc_reviewer` | **Installable now.** Content capabilities, `text` tier. Of these only the skill currently reaches the agent — `loadPluginSkills()` filters on `type === "skill"`; the prompt and sub-agent install and sit inert until a consumer lands. |
| `docs` and `convert` providers, and the tools bound to them | Scaffolding. The MCP server and the converter validate their inputs and report what they would do; neither implements real `.docx`/`.xlsx` parsing yet. They ship so the manifest, the artifact hashing and the sandbox wiring are exercised end to end. |
| `cloud` and `gallery` providers | The endpoints under `api.zeraix.com/office/` are **not live**. Declared now so the permission and `needs` shape is reviewed before anything depends on it. |
| `ocr_reader`, `sheet_preview`, `monthly_report`, `style_tokens`, `template_gallery`, `house_style` | Reserved capability types the client cannot install yet (Phase 2+). |

None of this is reachable by users while `PLUGINS_UI_ENABLED` is `false` in the app.

## Structures

**All six provider kinds:**

| Provider | Kind | Tier | Demonstrates |
|---|---|---|---|
| `docs` | `mcp-stdio` | `sandboxed` | Local MCP server: `runtime`, `entry`, `args`, hashed artifact, filesystem grants |
| `cloud` | `mcp-http` | `sandboxed` | Remote MCP: `url`, network + credential permissions, a **secret** `needs` prompt |
| `convert` | `process` | `sandboxed` | Plain subprocess: `runtime`, `entry`, `args`, hashed artifact |
| `gallery` | `http` | `sandboxed` | Plain HTTP service: `url`, a wildcard network host, a non-secret `needs` |
| `native` | `builtin` | `host` | Host tier — declares **no** permissions, because on `host` they would be advisory only (§4.2) |
| `bundled` | `text` | `text` | The non-executing kind. Tier and kind must agree: `text` cannot execute, everything else cannot claim `text` |

**All nine capability types:** `tool` ×4, `model`, `resource` ×2, `skill`, `prompt`, `memory`,
`subagent`, `workflow`, `ui`.

**All three binding forms** — the part most worth copying:

- **Static content** — `path` + `sha512`, no provider. Used by `skill`, `prompt`, `memory`,
  `subagent`, `workflow`, `ui`. *Omit `sha512` when you submit*: CI hashes the bytes and injects it.
- **A single provider** — `"provider": "docs"`. Used by the tools and the model.
- **An ordered `bind` chain** — `convert_to_pdf` prefers `native` when `host.hasOfficeInstalled` and
  falls back to `convert`. This is how one capability spans hosts that differ.

Also shown: `module` grouping (the consent sheet groups by it — "adds 3 document tools and a skill"),
`homepage`, and the reserved `pricing` object.

## Why the warnings are expected

`build-registry-index.mjs --check` emits 17 warnings against this plugin, and every one is a
reserved-but-not-yet-runnable notice:

```
warning: providers.docs: provider kind "mcp-stdio" is not implemented yet
warning: capabilities[0]: capability type "tool" is not implemented yet
warning: capabilities[4]: type "model" requires elevated review (design doc §4.3)
…
```

A manifest is valid or not independently of which phase of the roadmap we are in:
`validateManifest()` decides validity, `installableCapabilities()` decides what a given build can
run. An older client meeting a newer manifest degrades exactly the same way — it installs what it
understands and records a reason for the rest.

## Layout

```
plugin.json                 the manifest (submit WITHOUT sha512 — CI injects it)
files/skill.md              skill capability      → frontmatter read by the app's own parser
files/prompt.md             prompt capability
files/memory.md             memory capability
files/subagent.md           subagent capability
files/workflow.json         workflow capability   → automation definition shape
files/ui/panel.html         ui capability         → sandboxed iframe, no external loads
files/server/index.js       providers.docs entry  → MCP stdio server
files/bin/convert.py        providers.convert entry
```

Every file under `files/` must be referenced by something in the manifest, or the build warns — an
unreferenced file is nearly always a rename someone missed.

## For submitters

`zeraix` is a **reserved publisher**. A pull request from a fork adding anything under
`plugins/zeraix/` fails validation by design: the namespace means "official" and the consent sheet
presents it that way. Submit under your own publisher name and copy the shape from here.

```bash
node <app>/scripts/build-registry-index.mjs --root . --check
```

That is the same command CI runs on your pull request, against the app's latest release tag.

This directory is committed even though its neighbours are not: `plugins/zeraix/.gitignore` lists
only the built-in skills, which are regenerated from the app's `src/skills/*.md` on every publish.

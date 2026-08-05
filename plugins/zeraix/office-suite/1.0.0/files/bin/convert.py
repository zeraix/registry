#!/usr/bin/env python3
"""Fallback document converter.

Declared by providers.convert: kind "process", tier "sandboxed", runtime "python",
entry "bin/convert.py". The registry hashes this file and pins the digest in the
index, so the bytes that run are the bytes that were reviewed.

This is the SECOND candidate of the convert_to_pdf capability's bind list. The
first is providers.native, gated on `host.hasOfficeInstalled` -- the installed
office application renders its own formats with exact fidelity, and nothing
portable matches it. This runs when that is unavailable, which on a typical
Linux or CI host is always.

Reads a job on stdin, writes a result on stdout, one JSON object each:

    {"input": "report.docx", "output": "report.pdf"}
    {"ok": true, "output": "report.pdf", "pages": 12}

This is scaffolding: it validates and reports rather than actually converting.
"""
import json
import os
import sys
from pathlib import Path

WORKSPACE = Path(os.environ.get("ZERAIX_WORKSPACE", os.getcwd())).resolve()
SUPPORTED = {".docx": "Word", ".xlsx": "Excel", ".pptx": "PowerPoint", ".odt": "OpenDocument"}


def resolve_in_workspace(rel_path: str) -> Path:
    """Resolve a caller-supplied path inside the workspace.

    Checked after resolution, not on the raw string: "a/../../etc/passwd" only
    shows itself as an escape once resolved, and screening for ".." in the input
    misses every other spelling of it. The sandbox would refuse this too; doing it
    here as well means the check does not depend on the sandbox being present.
    """
    if not rel_path or not isinstance(rel_path, str):
        raise ValueError("input is required")
    candidate = (WORKSPACE / rel_path).resolve()
    if candidate != WORKSPACE and WORKSPACE not in candidate.parents:
        raise ValueError(f"path escapes the workspace: {rel_path}")
    return candidate


def convert(job: dict) -> dict:
    source = resolve_in_workspace(job.get("input"))
    if source.suffix.lower() not in SUPPORTED:
        raise ValueError(
            f"unsupported format '{source.suffix}' "
            f"(supported: {', '.join(sorted(SUPPORTED))})"
        )

    destination = resolve_in_workspace(job.get("output") or f"{source.stem}.pdf")
    if destination.suffix.lower() != ".pdf":
        raise ValueError("output must be a .pdf path")

    # A real converter would render here. Reporting the resolved plan instead keeps
    # this honest about what it does rather than emitting an empty PDF.
    return {
        "ok": True,
        "output": str(destination.relative_to(WORKSPACE)),
        "format": SUPPORTED[source.suffix.lower()],
        "pages": None,
        "note": "reference converter: validated the job, produced no file",
    }


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        json.dump({"ok": False, "error": "no job on stdin"}, sys.stdout)
        return 2
    try:
        result = convert(json.loads(raw))
    except (ValueError, json.JSONDecodeError) as exc:
        # Exit non-zero AND report on stdout: the caller reads the JSON, the
        # execution manager reads the exit code, and they must not disagree.
        json.dump({"ok": False, "error": str(exc)}, sys.stdout)
        return 1
    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

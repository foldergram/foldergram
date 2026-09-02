#!/usr/bin/env python3
"""Generate a small local symbol index (.ai/tags + .ai/SYMBOL_INDEX.md).

Usage: ai-index-symbols.py <repo-root> <src-dir[,src-dir...]> [ext1,ext2,...]
Env:   AI_INDEX_FUNCS=0  -> index type declarations only (smaller index)
"""
import os
import re
import sys
from datetime import datetime
from pathlib import Path

root = Path(sys.argv[1]).resolve()
src_dirs = [Path(p).resolve() for p in sys.argv[2].split(",") if p]
exts = [e if e.startswith(".") else "." + e
        for e in (sys.argv[3] if len(sys.argv) > 3 else ".ts").split(",") if e]
index_funcs = os.environ.get("AI_INDEX_FUNCS", "1") != "0"

MOD = r"(?:(?:public|private|internal|protected|open|abstract|final|static|export|default|data|sealed|inner|annotation|value|declare)\s+)*"

RULES = {
    ".kt": {
        "types": [rf"^\s*(?:@\w+(?:\([^)]*\))?\s*)*{MOD}(?P<kind>class|object|interface|enum\s+class)\s+(?P<name>[A-Za-z_]\w*)"],
        "funcs": [],
        "annotated": [("@Composable", "compose", r"^\s*(?:\w+\s+)*fun\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.]*\.)?(?P<name>[A-Za-z_]\w*)\s*[<(]")],
    },
    ".java": {
        "types": [rf"^\s*{MOD}(?P<kind>class|interface|enum|record)\s+(?P<name>[A-Za-z_]\w*)"],
        "funcs": [],
        "annotated": [],
    },
    ".ts": {
        "types": [rf"^\s*{MOD}(?P<kind>class|interface|enum|type)\s+(?P<name>[A-Za-z_]\w*)"],
        "funcs": [
            r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?P<kind>function)\s*\*?\s*(?P<name>[A-Za-z_]\w*)\s*[<(]",
            r"^\s*export\s+(?P<kind>const|let)\s+(?P<name>[A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function|\(|<)",
            # Singleton / namespace object exports, e.g. `export const galleryService = {`
            # and `export const svc = new Service()`. Common in this repo's service layer.
            r"^\s*export\s+const\s+(?P<name>[A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(?P<kind>\{|new\b)",
            # Pinia stores and other factory-call exports, e.g. `export const useFeedStore = defineStore(`
            r"^\s*export\s+const\s+(?P<name>[A-Za-z_]\w*)\s*=\s*(?P<kind>defineStore|createRouter|defineComponent)\s*\(",
        ],
        "annotated": [],
    },
    ".py": {
        "types": [r"^(?P<kind>class)\s+(?P<name>[A-Za-z_]\w*)"],
        "funcs": [r"^(?:async\s+)?(?P<kind>def)\s+(?P<name>[A-Za-z_]\w*)\s*\("],
        "annotated": [],
    },
    ".go": {
        "types": [r"^\s*(?P<kind>type)\s+(?P<name>[A-Za-z_]\w*)"],
        "funcs": [r"^(?P<kind>func)\s+(?:\([^)]*\)\s*)?(?P<name>[A-Za-z_]\w*)\s*[<(]"],
        "annotated": [],
    },
    ".rs": {
        "types": [rf"^\s*(?:pub(?:\([^)]*\))?\s+)?(?P<kind>struct|enum|trait|impl|mod)\s+(?P<name>[A-Za-z_]\w*)"],
        "funcs": [r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?P<kind>fn)\s+(?P<name>[A-Za-z_]\w*)\s*[<(]"],
        "annotated": [],
    },
    ".swift": {
        "types": [rf"^\s*{MOD}(?P<kind>class|struct|enum|protocol|extension|actor)\s+(?P<name>[A-Za-z_]\w*)"],
        "funcs": [rf"^\s*{MOD}(?P<kind>func)\s+(?P<name>[A-Za-z_]\w*)\s*[<(]"],
        "annotated": [],
    },
}
RULES[".tsx"] = RULES[".ts"]
RULES[".js"] = RULES[".ts"]
RULES[".jsx"] = RULES[".ts"]
RULES[".mts"] = RULES[".ts"]
RULES[".mjs"] = RULES[".ts"]
RULES[".vue"] = RULES[".ts"]
RULES[".kts"] = RULES[".kt"]

def compile_rules(cfg):
    return {
        "types": [re.compile(p) for p in cfg["types"]],
        "funcs": [re.compile(p) for p in cfg["funcs"]] if index_funcs else [],
        "annotated": [(m, k, re.compile(p)) for m, k, p in cfg["annotated"]],
    }

COMPILED = {ext: compile_rules(cfg) for ext, cfg in RULES.items()}
SKIP_DIRS = {"node_modules", "build", "dist", "out", ".git", "__pycache__", "target", "vendor", ".venv"}

tags, rows = [], []
seen = set()
files = []
for src in src_dirs:
    for e in exts:
        files.extend(src.rglob("*" + e))
for path in sorted(set(files)):
    if path.name.startswith("._") or any(part in SKIP_DIRS for part in path.parts):
        continue
    cfg = COMPILED.get(path.suffix)
    if not cfg:
        continue
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        rel = path.as_posix()
    if rel in seen:
        continue
    seen.add(rel)
    pending = None
    for i, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        stripped = line.strip()
        hit = None
        for rx in cfg["types"] + cfg["funcs"]:
            m = rx.search(line)
            if m:
                raw_kind = m.groupdict().get("kind") or "decl"
                kind = {"{": "object", "new": "instance"}.get(raw_kind.strip(), raw_kind.strip())
                hit = (m.group("name"), kind.replace(" ", "_"))
                break
        if hit is None and pending:
            marker_kind, rx = pending
            m = rx.search(line)
            if m:
                hit = (m.group("name"), marker_kind)
        if hit:
            name, kind = hit
            tags.append(f'{name}\t{rel}\t{i};"\t{kind}')
            rows.append((name, kind, rel, i))
            pending = None
            continue
        matched_marker = next((k, rx) for m2, k, rx in cfg["annotated"] if stripped.startswith(m2)) if any(stripped.startswith(m2) for m2, _, _ in cfg["annotated"]) else None
        if matched_marker:
            pending = matched_marker
        elif not stripped.startswith("@"):
            pending = None

out_dir = root / ".ai"
out_dir.mkdir(parents=True, exist_ok=True)
tags.sort()
rows.sort(key=lambda item: (item[2], item[3], item[0]))
now = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z")

(out_dir / "tags").write_text("\n".join([
    "!_TAG_FILE_FORMAT\t2\t/extended format/",
    "!_TAG_FILE_SORTED\t1\t/0=unsorted, 1=sorted/",
    "!_TAG_PROGRAM_NAME\tai-map.symbol-index\t//",
    *tags, "",
]), encoding="utf-8")

md = ["# Symbol Index", "", f"Generated: {now}", "",
      "Local index of type declarations and notable functions.",
      "Look up a symbol here, then open that file. Do not dump the repo.", ""]
current = None
for name, kind, rel, line in rows:
    if rel != current:
        md.append(f"## `{rel}`")
        current = rel
    md.append(f"- `{name}` ({kind}) :{line}")
md.append("")
(out_dir / "SYMBOL_INDEX.md").write_text("\n".join(md), encoding="utf-8")
print(f"Wrote {out_dir/'tags'} ({len(rows)} symbols)")
print(f"Wrote {out_dir/'SYMBOL_INDEX.md'}")

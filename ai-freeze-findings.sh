#!/usr/bin/env bash
set -euo pipefail

cat <<'TEMPLATE'
# Evidence Freeze

Use this before editing when investigation starts to repeat.

## Stop Searching When

- The same files or symbols appeared in two search rounds.
- The likely target files are known.
- The remaining question can be answered by reading those files, not by more searching.
- The user asked to only diagnose, or to only make a bounded fix.

## Frozen Facts

- User symptom:
- Code evidence (file:line):
- Reference evidence (if any):
- Exact problem location:
- Proposed solution:
- Files to edit:
- Validation command:
- Unknowns that still matter:

## Next Action

Choose one: read targeted files, implement, validate, or ask the user for missing runtime evidence.
Do not run another broad search unless a frozen unknown requires it.
TEMPLATE

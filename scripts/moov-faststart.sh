#!/bin/bash
# Batch moov faststart for mp4/mov files in the gallery.
# Moves the moov atom to the front of the file so playback can start
# without reading the entire file. Uses -c copy (no re-encoding).
#
# Idempotent: files whose moov atom already precedes mdat are skipped, so the
# script is safe to run again over the whole library (e.g. after adding media).
#
# Usage: GALLERY_ROOT=/path/to/gallery bash scripts/moov-faststart.sh [--dry-run]

set -euo pipefail

GALLERY_ROOT="${GALLERY_ROOT:?Set GALLERY_ROOT to the gallery root directory}"
DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

TOTAL=0
SKIPPED=0
FIXED=0
FAILED=0

# 4 MiB of head is plenty: a faststart file always starts with moov before mdat,
# and top-level metadata boxes never grow beyond a few hundred KB.
HEAD_BYTES=4194304

function atom_offset() {
  # Prints the byte offset of the first occurrence of $2 inside the head of $1.
  head -c "$HEAD_BYTES" "$1" 2>/dev/null | LC_ALL=C grep -abo -m1 "$2" 2>/dev/null | cut -d: -f1 || true
}

function is_faststart() {
  local file="$1"
  local moov_offset mdat_offset
  moov_offset=$(atom_offset "$file" moov)
  mdat_offset=$(atom_offset "$file" mdat)

  # A file with moov before mdat (or no mdat visible in the head at all) already
  # starts streaming without a tail read. Heuristic, but moov/mdat are top-level
  # box names and video payload essentially never contains those bytes in the head.
  if [[ -n "$moov_offset" && ( -z "$mdat_offset" || "$moov_offset" -lt "$mdat_offset" ) ]]; then
    return 0
  fi

  return 1
}

while IFS= read -r -d '' file; do
  TOTAL=$((TOTAL + 1))

  if is_faststart "$file"; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if $DRY_RUN; then
    echo "[dry-run] would process: $file"
    continue
  fi

  # Create a temp file, run faststart, replace if successful.
  tmp="${file}.faststart.tmp"
  orig_mode=$(stat -f%Lp "$file" 2>/dev/null || stat -c%a "$file" 2>/dev/null || echo '')
  if ffmpeg -y -i "$file" -c copy -movflags +faststart "$tmp" 2>/dev/null; then
    # Only replace if the temp file is valid and not much smaller (which would indicate failure)
    tmp_size=$(stat -f%z "$tmp" 2>/dev/null || stat -c%s "$tmp" 2>/dev/null || echo 0)
    orig_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
    # Allow up to 1% size difference (moov movement can slightly change padding)
    min_size=$((orig_size * 99 / 100))
    if [[ "$tmp_size" -ge "$min_size" && "$tmp_size" -gt 0 ]]; then
      if [[ -n "$orig_mode" ]]; then
        chmod "$orig_mode" "$tmp" 2>/dev/null || true
      fi
      mv "$tmp" "$file"
      FIXED=$((FIXED + 1))
      echo "[fixed] $file"
    else
      rm -f "$tmp"
      SKIPPED=$((SKIPPED + 1))
      echo "[skip] $file (output too small, keeping original)"
    fi
  else
    rm -f "$tmp"
    FAILED=$((FAILED + 1))
    echo "[FAIL] $file"
  fi
done < <(find "$GALLERY_ROOT" -type f \( -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.mov' \) -not -path '*/._*' -print0)

echo ""
echo "Done: total=$TOTAL fixed=$FIXED skipped=$SKIPPED failed=$FAILED"

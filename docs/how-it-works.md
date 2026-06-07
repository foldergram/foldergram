---
title: How It Works
description: The indexing model, storage layout, scan lifecycle, and feed logic behind Foldergram.
---

# How It Works

## Architecture at a glance

Foldergram has two deliberate layers:

1. A scanner/indexer that walks the gallery tree, updates the database, and generates derivatives.
2. A runtime API and SPA that read indexed data from the database and serve static derivative assets.

That separation is the core performance decision in the project.

The database backend is selected by `DB_DRIVER` and can be either SQLite (default) or PostgreSQL. Both use the same repository interface and migration set.

## Source discovery model

Foldergram recursively walks `GALLERY_ROOT` and applies these rules:

- Hidden paths are skipped.
- Managed storage paths under the gallery root are skipped.
- Folder exclusions from `GALLERY_EXCLUDED_FOLDERS` and saved `General Settings` rules are skipped.
- Any non-hidden folder that directly contains supported media becomes an indexed album.
- Files directly in `GALLERY_ROOT` are ignored.
- Nested folders are treated separately from their parent folders.
- In the default reserved-stories mode, a child `stories/` folder beneath an indexed owner folder is withheld from normal album discovery and scanned separately as story data.

## Reserved stories folders

By default, Foldergram treats `AppFolder/stories` as a reserved subtree for
that app folder.

The scan model is:

- direct media inside `AppFolder/stories` becomes a `story_root` folder used for the avatar story set
- each direct child directory under `AppFolder/stories` becomes one `story_capsule`
- nested media below that direct child directory is collected recursively into the same capsule
- reserved story folders do not become normal app folders while this mode is enabled
- if the reserved root has no direct media but highlight capsules exist, Foldergram synthesizes an avatar-story entry from recent highlight media

This behavior is controlled by the Settings toggle `Treat stories folders as
normal app folders`. When that legacy mode is enabled, `stories/` folders are
discovered like ordinary app folders again.

## Excluded folders

Foldergram merges exclusion rules from:

- `GALLERY_EXCLUDED_FOLDERS`
- custom rules saved from `Settings -> General Settings`

Rule semantics are intentionally simple:

- values without a slash match folder names anywhere in the gallery tree
- values with a slash match one exact relative path below `GALLERY_ROOT`

Excluded folders are skipped during startup scans, rescans, and watcher-driven
discovery work. Changing the saved runtime rules updates `app_settings`
immediately, but a follow-up scan from `Settings -> Scan & Library` is still
required so already-indexed matches can be soft-removed from the library.

## Storage layout

By default the app uses:

```text
data/
  gallery/       # originals
  db/
    gallery.sqlite
  thumbnails/    # asset-key-sharded thumbnail derivatives
  previews/      # asset-key-sharded preview derivatives
  scan-errors/   # created on demand for full scan error reports
```

The database schema includes:

- `folders`
- `images`
- `places`
- `scan_runs`
- `app_settings`
- `folder_scan_state`
- `likes`
- `collections`
- `collection_items`

## What is stored per indexed post

The `images` table stores:

- a stable `asset_key` used for derivative storage
- normalized relative and absolute paths
- file size and `mtime_ms`
- width and height
- display orientation and animation flags when relevant
- media type and MIME type
- duration for videos
- a fingerprint built from `relative_path + file_size + mtime_ms`
- `sort_timestamp`
- `taken_at` and `taken_at_source`
- an optional `place_id` for GPS-resolved photos
- stored derivative paths
- playback strategy for videos
- soft-delete state including `deleted_at`
- trash state including `trashed_at`

## Stored folder counts

The `folders` table stores pre-computed aggregate columns updated after each scan and mutation:

| Column | Description |
| --- | --- |
| `image_count` | Non-deleted, non-trashed, non-cover posts in this folder |
| `video_count` | Same filter, videos only |
| `latest_image_mtime_ms` | Most recent `mtime_ms` across qualifying posts |

These are updated by `folderRepository.updateCounts()` — called per folder after scan processing completes, and after UI-triggered mutations (trash, restore, delete).

Global totals (`stat.media_count`, `stat.video_count`, `stat.folder_count`) are stored as key-value rows in `app_settings` and refreshed by `statsRepository.refresh()` at scan completion and after folder-level mutations. The status endpoint reads these with O(1) single-key lookups — no `COUNT(*)` or `SUM()` at read time.

## Stable ordering

Foldergram preserves stable sort order across rescans.

If a file already exists in the database, the scanner keeps its prior
`sort_timestamp`. If not, it falls back to:

1. the existing `first_seen_at`, if present
2. the current file `mtime_ms`

That prevents older posts from jumping around every time the library is rescanned.

## Soft delete and reactivation

Foldergram does not hard-delete missing indexed files during scans.

Instead it:

- marks missing files as `is_deleted = 1`
- records `deleted_at`
- keeps their historical row data
- reactivates them if the same relative path reappears later

Direct user-triggered delete actions are different. Those remove the source file
and derivatives first, then mark or remove the indexed records as part of the
delete flow.

## Trash versus permanent delete

Foldergram also supports a separate user trash state for admin delete flows.

- moving a post to Trash keeps the original file on disk
- trashed posts are hidden from feed, folder, detail, likes, and collections surfaces
- restoring a trashed post makes it visible again without a rescan
- permanently deleting a post removes the original file plus derivatives

This is separate from scan-time `is_deleted`, which tracks missing files on disk.

## Folder shortcuts during scans

To avoid unnecessary work, Foldergram records per-folder scan signatures in
`folder_scan_state`. If a folder signature still matches and metadata coverage is
complete, the scanner can skip reprocessing every file in that folder.

That shortcut is bypassed when Foldergram needs to repair unchanged derivatives
or when gallery-root assumptions no longer match.

## Full scan lifecycle

During a full scan, Foldergram:

1. Walks the gallery tree to discover source folders.
2. Stats supported files in those folders.
3. Resolves folder records and stable slugs.
4. Scans reserved `stories/` subtrees for owner folders when reserved-stories mode is active.
5. Reads or refreshes media metadata.
6. Reconciles eligible file moves so the same row, likes, and derivative paths can survive path changes.
7. Marks missing indexed rows as deleted.
8. Queues derivative work for changed or missing outputs.
9. Depending on `SCAN_MEDIA_ERROR_MODE`, either records and skips supported-media failures or fails fast on the first one.
10. Performs deferred stale-derivative cleanup after successful scans.
11. Writes scan status to `scan_runs` and, when needed, a per-run full scan error report.

## Scan progress phases

Foldergram reports long-running scans in three phases:

- `migration` checks previously indexed rows, backfills missing `asset_key` values, and moves, repairs, or regenerates legacy derivatives before fresh indexing begins
- `discovery` walks the gallery tree, resolves folders, refreshes metadata, and reconciles safe file moves
- `derivatives` processes queued thumbnail and preview jobs after discovery has identified the required work
- completed runs can finish as `completed_with_errors` when skip mode records supported-media failures

Only migration and derivative work have a fixed total upfront. Discovery still
reports discovered and processed folder and post counts, but the client keeps
that phase indeterminate because the final discovery total can keep growing
while more folders are found.

## Incremental scans and watching

The project includes a chokidar watcher for development. It batches changes with
a `700ms` debounce window and chooses between:

- a full rescan for directory add/remove events
- an incremental scan for file-level changes

The watcher is not part of request handling, and request handlers never scan the
filesystem directly.

## Feed behavior

The home feed supports three modes:

| Mode | Behavior |
| --- | --- |
| `recent` | Uses `taken_at` when available, otherwise `sort_timestamp`, then diversifies bursts from the same folder. |
| `rediscover` | Surfaces posts older than 180 days and prioritizes liked items within that older pool. |
| `random` | Uses a deterministic seeded shuffle so a browsing session stays stable while paging. |

## Reels behavior

The `/reels` route reads only indexed video candidates from SQLite. It does not
scan the filesystem on request.

The page opens with the app-wide default configured in Settings and does not
provide an inline mode switch of its own.

| Mode | Behavior |
| --- | --- |
| `recommended` | Builds a seeded queue from indexed videos using freshness, likes, folder-affinity signals from recent navigation, portrait fit, duration fit, and a small deterministic jitter. It also penalizes immediate repeats from the same folder when alternatives exist. |
| `recent` | Uses newest indexed videos first. |
| `random` | Uses a deterministic seeded shuffle so the queue stays stable while paging. |

## Moments and highlights

`GET /api/feed/moments` can return either Moments or Highlights.

### Moments

Foldergram prefers date-based moments when the library has enough EXIF-backed
timestamps:

- at least `24` indexed posts
- at least `18` posts with `taken_at_source = 'exif'`
- at least `30%` EXIF coverage

The current date-driven capsules are:

- On This Day
- This Week
- Last Year Around Now

These date-driven capsule payloads also include structured calendar parts so
the client can localize their labels from the server-selected dates instead of
rebuilding the windows in the browser.

### Highlights

When date coverage is too sparse, Foldergram falls back to curated sets:

- Recent Batches
- Forgotten Favorites
- Deep Cuts
- Lucky Dip

## Places resolution

Places are an offline, opt-in layer built from photo GPS metadata.

- admins prepare a local GeoNames dataset from `Settings -> Places`
- rebuilding place assignments reads stored EXIF latitude and longitude from indexed photos
- matched results are stored in the `places` table and linked from `images.place_id`
- runtime Places pages then read only from SQLite, just like feed and folder pages

Photos without GPS metadata, and videos, simply remain unassigned.

## Folder stories

Folder stories use separate SQLite-backed queries from `GET /api/feed/moments`.

- folder summaries expose whether a folder currently has an avatar-story entry point
- `GET /api/folders/:slug/stories` returns the folder's avatar story and highlight capsules
- `GET /api/folders/:slug/stories/:id` pages through the media for one story capsule
- neither route walks the filesystem on request

## Saved posts and collections

Foldergram keeps likes separate from saved-post collections.

- `admin` and `viewer` sessions store shared likes and collections in SQLite
- anonymous public sessions use browser-local favorites and collections instead
- a default saved collection is always present, and custom collections can group the same post into multiple buckets
- because normal rescans preserve stable image rows when possible, shared collection membership usually survives ordinary maintenance scans

## Gallery root relocation

Foldergram tracks the last successful gallery root. If that path changes and
there is already indexed content, startup first validates whether the new root
still represents the same indexed library.

If validation succeeds, Foldergram refreshes stored absolute source paths and
continues using the current index, likes, thumbnails, previews, and sort
ordering. If validation fails, the scanner marks the library as requiring a
rebuild to prevent silent cross-library drift.

## Derivative migration and move preservation

On upgraded libraries, the next full scan backfills `asset_key` values and
moves stored derivatives from the legacy mirrored layout into the new sharded
layout. The migration only rewrites stored derivative paths when the new target
already exists, and it repairs surviving legacy files before falling back to
regeneration. After that migration is complete, full rescans can reconcile safe
file moves by matching size, rounded mtime, and extension, with a basename
tie-break when needed. When reconciliation succeeds, the original row ID, likes,
`sort_timestamp`, and derivative paths are preserved.

## Runtime read model

Once data is indexed:

- folder pages read from SQLite
- feed pages read from SQLite
- likes read from SQLite
- moments, highlights, and folder stories read from SQLite
- thumbnails and previews are served as static files
- originals are served by image ID only

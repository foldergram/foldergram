---
title: Configuration
description: Environment variables, excluded-folder rules, path behavior, and scan controls in Foldergram.
---

# Configuration

For source installs, Foldergram reads `.env` from the repository root and
validates it in `server/src/config/env.ts`.

In the default Docker Compose setup, the container uses the image's built-in
production defaults plus the mounted `./data/...` volumes. The source-install
`.env` file is not read directly inside the container unless you wire that in
yourself.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | Must be `development`, `test`, or `production`. |
| `SERVER_PORT` | `4141` | Production Express port. Used by Docker and `pnpm start`. |
| `DEV_SERVER_PORT` | `4140` | Express server port during `pnpm dev`. |
| `DEV_CLIENT_PORT` | `4141` | Base Vite dev server port during `pnpm dev`. The client may fall forward through `4144`. The same range is allowed for non-production local-origin mutation checks. |
| `DATA_ROOT` | `./data` | Base directory for app-managed storage. Other storage paths default under it unless overridden. |
| `DATA_DIR` | unset | Optional alias that falls back into `DATA_ROOT` resolution when `DATA_ROOT` is absent. |
| `GALLERY_ROOT` | `./data/gallery` | Source media root. Foldergram scans below this path. |
| `GALLERY_EXCLUDED_FOLDERS` | unset | Comma-separated folder exclusion rules. Names match anywhere in the gallery tree; values with a slash match one exact relative path below `GALLERY_ROOT`. |
| `DB_DIR` | `./data/db` | SQLite directory. Database file is `gallery.sqlite`, and startup Dbmate migrations run against it automatically when the directory is available. |
| `THUMBNAILS_DIR` | `./data/thumbnails` | Generated thumbnail output root. |
| `PREVIEWS_DIR` | `./data/previews` | Generated preview output root. |
| `IMAGE_DETAIL_SOURCE` | `preview` | For image detail pages, use generated previews or stream originals. Videos ignore this flag. |
| `DERIVATIVE_MODE` | `eager` | Generate derivatives during scans or lazily on the first protected derivative request. |
| `LOG_VERBOSE` | `0` | Truthy values are `1`, `true`, `yes`, and `on`. |
| `SCAN_MEDIA_ERROR_MODE` | `skip` | `skip` reports supported-media scan failures and continues. `fail` aborts on the first such error. |
| `LIBRARY_AUTO_SCAN_ENABLED` | `true` | When false, startup and watcher scans are disabled; library scans run only from the admin action. |
| `SCAN_DISCOVERY_CONCURRENCY` | `4` | Discovery concurrency, validated from `1` to `32`. |
| `SCAN_DERIVATIVE_CONCURRENCY` | `4` | Derivative concurrency, validated from `1` to `32`. |
| `PUBLIC_DEMO_MODE` | `0` | When enabled, mutating API routes return `403` for read-only demo deployments. |
| `CSRF_TRUSTED_ORIGINS` | unset | Comma-separated extra browser origins allowed for mutating API requests. Useful behind reverse proxies or HTTPS terminators. |

## Database migrations

Foldergram stores the app database at `<DB_DIR>/gallery.sqlite`.

When `DB_DIR` is available, startup automatically runs pending Dbmate
migrations before the server opens that database. This happens for:

- Docker container startup
- `pnpm dev`
- `pnpm start`
- `pnpm rescan`

Fresh installs create the database from the baseline migration. Existing
supported installs are baselined once on upgrade, so later releases can apply
ordered schema changes automatically.

Startup also validates the schema behind recorded folder-sharing and posts
migrations. If an earlier startup recorded one of those migrations before its
schema work began, Foldergram safely clears that incomplete marker and resumes
the ordered migration. If a schema is only partially transformed or contains
new data that cannot be rolled back safely, startup stops instead of guessing.

For source installs, use `pnpm migrate` if you want to apply pending
migrations without starting the rest of the app.

## Access protection configuration

Shared-password protection is **not** configured in `.env`.

Instead:

- enable it from the Settings page
- Foldergram stores the password hash and session metadata in SQLite `app_settings`
- deleting or replacing the SQLite database resets the configured password protection state

The built-in auth model is a small role-based password gate for one app
instance, not a multi-user account system.

## Stories folders mode

Reserved stories behavior is **not** configured in `.env`.

Instead:

- Foldergram stores the current stories-folders mode in SQLite `app_settings`
- the Settings page exposes the toggle `Treat stories folders as normal app folders`
- the default mode is reserved stories, where `AppFolder/stories` powers avatar stories and highlight capsules
- turning the toggle on enables legacy behavior, where folders literally named `stories` remain ordinary app folders
- changing this setting requires a rescan because the indexed folder structure changes
- if the existing library already contains candidate `stories/` folders, Settings can show a migration decision card until you choose a mode

## Folder photo order default

The default app-folder photo order is **not** configured in `.env`.

Instead:

- Foldergram stores the current default order in SQLite `app_settings`
- `Settings -> General Settings` exposes `Newest First` and `Oldest First`
- the default is `Newest First`
- this setting changes app-folder grids and previous/next navigation inside the post viewer when browsing within a folder

## Nested folder title format

Nested folder title format is **not** configured in `.env`.

Instead:

- Foldergram stores the current nested-folder title preference in SQLite `app_settings`
- `Settings -> General Settings` exposes `Nested folder title format`
- available options are `Folder name only` and `Parent + folder name`
- the default is `Folder name only`
- this setting changes presentation only for nested app-folder titles
- renamed parent folders use their saved app title as the prefix when available
- it does not change scans, slugs, folder paths, or saved folder metadata

## Places setup

Offline places support is **not** configured in `.env`.

Instead:

- `Settings -> Places` can prepare the offline GeoNames dataset on demand
- `Settings -> Places` can rebuild place assignments for already indexed photos
- only photos with GPS EXIF metadata participate in place assignment
- the Places directory and place detail pages read from SQLite after that preparation work completes

## Excluded folders

Folder exclusions can come from two places:

- `GALLERY_EXCLUDED_FOLDERS` in `.env` or Docker Compose
- custom rules saved from `Settings -> General Settings`

Behavior:

- rules without a slash match folder names anywhere in the gallery tree, such as `@eaDir` or `thumbnails`
- rules with a slash match one exact relative folder path under `GALLERY_ROOT`, such as `Archive/cache`
- env-backed rules appear read-only in `General Settings`
- custom rules are stored in SQLite `app_settings` and can be changed at runtime
- after changing custom rules, run a full scan from `Settings -> Scan & Library` so already-indexed matches are soft-removed from the library

## Settings sections

The Settings sidebar is split into:

- `Scan & Library` for manual scans, thumbnail rebuilds, and library-index rebuilds
- `General Settings` for Home/Reels defaults, default folder order, nested folder title format, stories and carousel folder modes, excluded folders, and save-and-scan notices tied to those app-wide rules
- `Places` for offline GeoNames preparation status and place-assignment rebuilds
- `Security & Access` for admin, viewer, and public-mode controls
- `System Status` for storage, index, and last-scan details

### Selecting scan folders

The `Scan folders` panel under `Settings -> Scan & Library` lets you limit manual library scans and thumbnail regeneration to selected folders below `GALLERY_ROOT`.

- Expand the folder list and select a parent folder to include its entire subtree.
- Save the selection before running `Scan Library` or `Regenerate Thumbnails`.
- Leave every folder unchecked to use the default full-library scope.
- A folder whose stored signature has not changed is skipped by manual scans; only new, changed, or not-yet-indexed folders are processed.
- Folders outside the selected scope remain indexed and are not marked as removed by a scoped scan.
- The saved scope is stored in the application database, so it remains after a restart and applies to future manual scans until changed.

## Path resolution rules

- `DATA_ROOT` is the common fallback parent for the app's storage directories.
- If you set only `DATA_ROOT=/mnt/foldergram`, the default paths become `/mnt/foldergram/gallery`, `/mnt/foldergram/db`, `/mnt/foldergram/thumbnails`, and `/mnt/foldergram/previews`.
- Setting `GALLERY_ROOT`, `DB_DIR`, `THUMBNAILS_DIR`, or `PREVIEWS_DIR` overrides only that specific path.
- `DATA_DIR` is a legacy alias. It is used only when `DATA_ROOT` is unset.
- Relative paths are resolved from the repository root.
- Absolute paths are used as-is.
- Foldergram reserves `<DATA_ROOT>/scan-errors` for per-run full scan error reports.
- `THUMBNAILS_DIR` and `PREVIEWS_DIR` must be separate, non-overlapping directories.
- The scan-error report directory must not overlap `THUMBNAILS_DIR` or `PREVIEWS_DIR`.
- `THUMBNAILS_DIR` cannot contain `GALLERY_ROOT`.
- `PREVIEWS_DIR` cannot contain `GALLERY_ROOT`.
- `GALLERY_ROOT` only needs read access for scans and originals.
- `DB_DIR`, `THUMBNAILS_DIR`, and `PREVIEWS_DIR` must be writable.
- `<DATA_ROOT>/scan-errors` is created on demand and must be writable when skip mode produces scan reports.

When `DB_DIR` cannot be created or written, Foldergram logs the reason, skips
Dbmate for that process, and falls back to an in-memory SQLite database.

Foldergram normalizes path separators so the same rules work with POSIX-style and
Windows-style paths.

## Detail source and derivative timing

### `IMAGE_DETAIL_SOURCE`

Accepted values:

- `preview`
- `original`

Behavior:

- applies to image detail pages only
- `preview` keeps `/image/:id` on generated preview assets
- `original` makes image detail pages use `/api/originals/:id`
- does not change feed cards, folder grids, avatars, or other list surfaces
- does not change video default playback behavior

### `DERIVATIVE_MODE`

Accepted values:

- `eager`
- `lazy`

Behavior:

- `eager` generates thumbnails and previews during scans
- `lazy` still indexes metadata during scans, but missing files are generated on the first request to `/thumbnails/...` or `/previews/...` and then cached on disk
- lazy mode applies to thumbnails and previews
- lazy mode keeps derivative URLs deterministic because the stored asset-key derivative paths are still persisted in SQLite

### Recommended combinations

| Goal | Suggested config |
| --- | --- |
| Current behavior | `IMAGE_DETAIL_SOURCE=preview`, `DERIVATIVE_MODE=eager` |
| Lowest upfront processing for large libraries | `IMAGE_DETAIL_SOURCE=original`, `DERIVATIVE_MODE=lazy` |

### `SCAN_MEDIA_ERROR_MODE`

Accepted values:

- `skip`
- `fail`

Behavior:

- `skip` is the default
- `skip` reports supported-media failures during stat, metadata, derivative generation, and derivative-migration repair work, then continues scanning the rest of the library
- scans with skipped media finish as `completed_with_errors` instead of `completed`
- admin-facing scan details keep a short sample in SQLite and point to the full per-run report under `<DATA_ROOT>/scan-errors/`
- `fail` preserves fail-fast behavior for those same scan-time media errors
- this applies to supported media that actually reaches the scanner, including supported images and videos
- unsupported extensions, hidden or excluded paths, and files placed directly in `GALLERY_ROOT` are still ignored earlier and do not produce scan error reports

### Settings actions and lazy mode

- `Scan Library` always refreshes index metadata.
- `Rebuild Library Index` resets and rebuilds the SQLite-backed index. Existing sharded derivatives remain reusable when the same indexed rows survive the upgrade path.
- In `DERIVATIVE_MODE=lazy`, neither a normal scan nor `Rebuild Library Index` pre-generates missing thumbnails or previews.
- `Regenerate Thumbnails` remains a manual thumbnail and video-poster rebuild only. It does not rebuild previews.
- When `SCAN_MEDIA_ERROR_MODE=skip` records media failures, the admin Settings view shows the full report path for that scan.
- Runtime-only app-wide controls such as stories mode, carousel mode, and excluded folders live under `Settings -> General Settings`, while scan and rebuild actions live under `Settings -> Scan & Library`.

## Derivative layout upgrade

Recent versions store derivatives under sharded asset-key paths instead of
mirroring the gallery tree. Existing libraries migrate on the next full scan:

- current derivative paths use a single shard segment based on the first two hex characters of `asset_key`, such as `thumbnails/ab/<asset_key>.webp` and `previews/ab/<asset_key>.webp`
- old mirrored rows keep working until the migration runs
- the migration backfills `asset_key` and moves derivative files in place
- stored derivative paths are updated only when the destination file already exists
- if a legacy derivative still exists but the stored path is broken, the next full scan repairs it before falling back to regeneration
- after migration, full rescans can preserve the same indexed media identity across safe folder moves
- stale derivatives from soft-deleted files are cleaned up after the retention window on later successful full scans

## Live scan progress

Foldergram exposes live scan state in three places:

- `GET /api/status` includes the current viewer-safe `scan` snapshot alongside broader shell status
- `GET /api/scan-progress` returns the same viewer-safe scan payload on its own for lighter polling
- `GET /api/admin/scan-progress` returns the admin-detailed scan payload, including current file and folder detail when available

Scan phases behave as follows:

- `migration` is determinate and reports checked rows, moved files, repaired files, missing files, and asset-key backfills
- `discovery` reports discovered and processed folders and posts, but remains open-ended while the scanner is still finding additional folders
- `derivatives` is determinate and reports queued-versus-completed jobs plus generated thumbnails and previews
- completed runs can finish as `completed_with_errors` when `SCAN_MEDIA_ERROR_MODE=skip` records supported-media failures

## Managed path ignores

If your configured database, thumbnails, or previews directories live inside the
gallery tree, Foldergram computes their relative paths and excludes them from
discovery. The same ignore protection applies to `<DATA_ROOT>/scan-errors`.
That prevents generated files and scan reports from being re-indexed as source
media.

## Recommended local `.env`

`.env.example` groups the main runtime settings in the same order shown above.
Production runtimes still use `SERVER_PORT`, which defaults to `4141` unless
you override it in Docker Compose or at process start.

```bash
NODE_ENV=development
SERVER_PORT=4141
DEV_SERVER_PORT=4140
DEV_CLIENT_PORT=4141
DATA_ROOT=./data
GALLERY_ROOT=./data/gallery
GALLERY_EXCLUDED_FOLDERS=
DB_DIR=./data/db
THUMBNAILS_DIR=./data/thumbnails
PREVIEWS_DIR=./data/previews
IMAGE_DETAIL_SOURCE=preview
DERIVATIVE_MODE=eager
LOG_VERBOSE=0
SCAN_MEDIA_ERROR_MODE=skip
SCAN_DISCOVERY_CONCURRENCY=4
SCAN_DERIVATIVE_CONCURRENCY=4
PUBLIC_DEMO_MODE=0
CSRF_TRUSTED_ORIGINS=
```

## Concurrency tuning

`SCAN_DISCOVERY_CONCURRENCY` affects filesystem stat and metadata discovery work.
`SCAN_DERIVATIVE_CONCURRENCY` affects Sharp and FFmpeg jobs.

Practical guidance:

- Keep the defaults on smaller machines.
- Increase discovery concurrency only when storage is fast enough to benefit.
- Increase derivative concurrency only when CPU, RAM, and disk bandwidth can handle it.

## Gallery structure expectations

Foldergram ignores files placed directly in `GALLERY_ROOT`.

It indexes ordinary folders that directly contain supported media. In the
default reserved-carousel mode, an App Folder can also qualify when its
`carousels/` directory has an immediate child containing supported media
directly, so carousel-only App Folders do not need a placeholder file:

```text
gallery/
  loose-file.jpg         # ignored
  trips/
    oslo/
      IMG_0001.jpg       # indexed folder
    berlin/
      notes.txt          # not indexed
```

In the default reserved-stories mode, Foldergram also treats
`AppFolder/stories` specially:

```text
gallery/
  AnimalPlanet/
    post-1.jpg          # indexed owner folder media
    stories/
      story-1.mp4       # avatar story set
      Lions/
        clip-1.mp4      # highlight capsule
        nested-1/
          clip-2.jpg    # still part of Lions
```

If you want folders literally named `stories` to remain ordinary app folders,
enable `Treat stories folders as normal app folders` in Settings and rescan the
library.

## Gallery root changes

Foldergram stores the last successful gallery root in `app_settings`.

When the configured gallery root changes and there is already indexed content,
Foldergram first validates whether the new root still matches the same indexed
library.

If every indexed file still exists under the new root with the same relative
path, size, rounded `mtime`, and extension:

- startup keeps using the existing index
- stored absolute source paths are refreshed to the current root
- originals, lazy derivatives, and later rescans use the new gallery root

If that validation fails, Foldergram marks the library as requiring a rebuild.
Until that rebuild happens:

- startup scanning is deferred
- manual rescans return `409`
- thumbnail rebuilds return `409`

Viewer-safe shell status comes from `GET /api/status`, with dedicated live scan
polling available from `GET /api/scan-progress`.

The current and previous gallery roots remain exposed only in
`GET /api/admin/stats`. Admin-only live scan file and folder detail is available
from `GET /api/admin/scan-progress` and from the `scan` field in
`GET /api/admin/stats`.

## Carousel-folder mode

The SQLite setting `library.treat_carousels_as_folders` controls folders named `carousels`. Its default `false` value reserves `AppFolder/carousels/<post>/` for multi-item posts. Enable **Treat carousels folders as normal app folders** from **Settings → General Settings** to index those paths as ordinary folders instead. When no indexed path conflicts with the reserved name, Settings can show a dismissible Carousel Posts introduction with an expandable folder example. Existing path collisions produce a migration decision card that remains available until a mode is saved. Settings shows a pending update until a successful full scan has applied the saved mode. Use **Scan Library** under normal conditions, or **Rebuild Library Index** when the gallery location requires a new index. There is no `.env` equivalent.

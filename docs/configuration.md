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

## SQLite concurrency and durability policy

Foldergram stores its gallery index in SQLite. Every persistent connection to
`gallery.sqlite` applies the same explicit policy:

- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = 5000`
- `PRAGMA journal_mode = WAL` for file-backed databases
- `PRAGMA synchronous = NORMAL` when WAL is active

If the database directory is unavailable and Foldergram falls back to an
in-memory database, it does not force WAL mode.

At startup, the resolved journal mode is logged once. WAL is enabled on a
best-effort basis: if the database filesystem cannot provide WAL, Foldergram
logs the resolved journal mode and continues instead of assuming that WAL is
active.

`busy_timeout` gives short overlapping writes up to five seconds to finish
instead of failing immediately with `SQLITE_BUSY`. It does not make unlimited
parallel writers safe. Run one Foldergram process against a database file at a
time; do not treat WAL as a replacement for a networked database or as support
for many application replicas.

### Filesystem and backup requirements

WAL depends on reliable shared-memory and file-locking behavior. Keep `DB_DIR`
on a local filesystem inside the host, even when `GALLERY_ROOT` is mounted from
a network share. Do not place the SQLite database on NFS or SMB-style storage
unless that storage's locking behavior has been validated for SQLite.

While the app is running, SQLite may create `gallery.sqlite-wal` and
`gallery.sqlite-shm` beside the database. Foldergram runs a truncating WAL
checkpoint on shutdown and logs `SQLite WAL checkpoint incomplete` when another
connection, such as a database viewer with an open read transaction, prevents
the checkpoint from completing.

A main-file-only backup is safe only after every process and SQLite connection
using the database has closed and the shutdown checkpoint has completed. When
backing up the database:

- for a main-file-only copy, stop Foldergram, close every other tool or process
  using `gallery.sqlite`, and wait for shutdown to finish
- otherwise include `gallery.sqlite`, `gallery.sqlite-wal`, and
  `gallery.sqlite-shm` together from a stopped or consistently snapshotted
  filesystem
- never delete the WAL sidecars to force a main-file-only backup

If the shutdown log reports an incomplete checkpoint, keep the WAL sidecars with
the database backup or close the remaining connections and let Foldergram
checkpoint cleanly on a later shutdown. Do not copy only the main database file
from an actively running process. `GALLERY_ROOT`, `DB_DIR`, `THUMBNAILS_DIR`,
and `PREVIEWS_DIR` remain independent; moving media to network storage does not
require moving the database with it.

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

Folder exclusion rules can come from two places:

- `GALLERY_EXCLUDED_FOLDERS` in `.env` or Docker Compose
- custom rules saved from `Settings -> General Settings`

Behavior:

- rules without a slash match folder names anywhere in the gallery tree, such as `@eaDir` or `thumbnails`
- rules with a slash match one exact relative folder path under `GALLERY_ROOT`, such as `Archive/cache`
- env-backed rules appear read-only in `General Settings`
- custom rules are stored in SQLite `app_settings` and can be changed at runtime
- after changing custom rules, run a full scan from `Settings -> Scan & Library` so already-indexed matches are soft-removed from the library

You can also exclude an individual subtree by placing an empty regular file
named exactly `.nofoldergram` inside its containing folder below `GALLERY_ROOT`.
This works alongside both rule sources without changing them. The marker name
is fixed: there is no environment variable or Settings control to configure it,
and the file contents are ignored. A marker directly in `GALLERY_ROOT` is ignored.

In development mode, adding or removing a marker requests a debounced full scan,
as does replacing a marker with a symlink or replacing a symlink with a regular
marker file. Content-only changes do not request a scan.
In Docker or other production deployments, run a manual full scan after changing
markers. See [How It Works](./how-it-works#excluding-a-subtree-with-nofoldergram)
for stories, carousel posts, and restoration behavior.

## Settings sections

The Settings sidebar is split into:

- `Scan & Library` for manual scans, thumbnail rebuilds, and library-index rebuilds
- `General Settings` for app language, Home/Reels defaults, default folder order, nested folder title format, stories and carousel folder modes, excluded folders, and save-and-scan notices tied to those app-wide rules
- `Places` for offline GeoNames preparation status and place-assignment rebuilds
- `Security & Access` for admin, viewer, and public-mode controls
- `System Status` for storage, index, and last-scan details

## App language

Choose the interface language in **Settings → General Settings**:

| Language | Locale |
| --- | --- |
| English | `en` |
| Spanish | `es` |
| Chinese | `zh` |
| German | `de` |

Changing the selector applies immediately in the current browser and saves a
local preference. Clicking **Save changes** also saves the selected language
as the app-wide default for browsers without their own local preference,
including the login screen.

Foldergram uses the first available choice in this order:

1. The browser's saved Foldergram language preference.
2. The saved app-wide default.
3. A supported browser language.
4. English.

Regional browser locales such as `de-AT` resolve to their supported base
language. The language setting changes interface text; folder names and
user-written captions remain as entered. There is no language environment
variable.

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

- `eager` generates required thumbnails and previews during scans. Qualifying
  direct-playback videos still receive posters but skip the playable preview.
- `lazy` still indexes metadata during scans, but missing required files are
  generated on the first request to `/thumbnails/...` or `/previews/...` and
  then cached on disk
- lazy mode applies to thumbnails and required previews
- lazy mode keeps derivative URLs deterministic because the stored asset-key
  derivative paths are still persisted in SQLite
- old normal video preview URLs resolve to the indexed original when the asset
  qualifies for direct playback

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

- **Scan for changes** is the primary scan action. It discovers additions,
  updates, removals, and exclusions without verifying generated media for
  unchanged assets. It sends `{"repairDerivatives": false}`.
- **Scan and repair derivatives** is the secondary scan action. It performs the
  same discovery and also checks generated media for unchanged files. It sends
  `{"repairDerivatives": true}`.
- `Rebuild Library Index` resets and rebuilds the SQLite-backed index. Existing sharded derivatives remain reusable when the same indexed rows survive the upgrade path.
- In `DERIVATIVE_MODE=lazy`, neither scan action nor `Rebuild Library Index` pre-generates missing thumbnails or required previews.
- `Regenerate Thumbnails` remains a manual thumbnail and video-poster rebuild only. It does not rebuild previews.
- When `SCAN_MEDIA_ERROR_MODE=skip` records media failures, the admin Settings view shows the full report path for that scan.
- Runtime-only app-wide controls such as stories mode, carousel mode, and excluded folders live under `Settings -> General Settings`, while scan and rebuild actions live under `Settings -> Scan & Library`.

External scripts can use the optional request body directly:

```http
POST /api/admin/rescan
Content-Type: application/json

{"repairDerivatives": false}
```

Omitting the body preserves the existing repair-default behavior. The
`pnpm rescan` script keeps that default.

### Direct-playback video previews

A video plays from its indexed original during normal browsing only when it is
an `.mp4` with compatible container, H.264 video, `yuv420p` pixels, AAC or no
audio, a known size of at most `24 MiB`, and a known display width of at most
`1500` pixels. Posters are always generated. Other videos continue to use
generated previews.

Active folder-share links and configured share passwords can require a
generated preview for shared delivery even when normal playback uses the
original. Those previews are created during eager processing of new or repaired
media, or on authorized shared first access.

Run **Scan and repair derivatives** to reclaim obsolete previews for
already-indexed qualifying videos. Quick scans do not perform bulk preview
cleanup.

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

## Slow request logging

To help profile large local libraries, the API logs slow work to the server console:

- API requests that finish above 1000 ms log one line such as `Slow API request: GET /admin/stats` with the elapsed duration
- internal indexed work that exceeds the same threshold logs a line such as `Slow request work: status.folder_count`
- with `LOG_VERBOSE=1` the slow threshold drops to 250 ms so near-slow requests and scans are easier to spot
- log lines use stable route names and never include query strings, file paths, or request contents
- in development mode, API responses may also carry a `Server-Timing` header so browsers can show request timing in DevTools

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

The SQLite setting `library.treat_carousels_as_folders` controls folders named `carousels`. Its default `false` value reserves `AppFolder/carousels/<post>/` for multi-item posts. Enable **Treat carousels folders as normal app folders** from **Settings → General Settings** to index those paths as ordinary folders instead. When no indexed path conflicts with the reserved name, Settings can show a dismissible Carousel Posts introduction with an expandable folder example. Existing path collisions produce a migration decision card that remains available until a mode is saved. Settings shows a pending update until a successful full scan has applied the saved mode. Use **Scan for changes** under normal conditions, or **Rebuild Library Index** when the gallery location requires a new index. There is no `.env` equivalent.

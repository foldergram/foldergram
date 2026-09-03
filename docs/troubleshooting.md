---
title: Troubleshooting
description: Common Foldergram issues and the exact implementation details behind them.
---

# Troubleshooting

## The app says the library storage is unavailable

Foldergram checks the configured:

- gallery directory
- thumbnails directory
- previews directory

If any of those are unavailable, the UI reports the reason exposed by the
backend.

Check:

- the configured paths in `.env`
- whether those paths exist
- whether `DB_DIR`, `THUMBNAILS_DIR`, and `PREVIEWS_DIR` are writable by the current process
- whether `<DATA_ROOT>/scan-errors` is writable if you use `SCAN_MEDIA_ERROR_MODE=skip`

`GALLERY_ROOT` is scanned read-only. It does not need write access unless you
use delete actions that remove originals from the gallery.

## The database keeps resetting

If `DB_DIR` is unavailable, Foldergram falls back to an in-memory SQLite
database. That means indexed state disappears when the process stops.

Fix the configured database directory first.

## Startup stops after an upgrade

Foldergram now runs pending SQLite migrations before it serves requests. If the
app stops during startup, check the server or container logs first.

Check:

- whether `DB_DIR` still exists and is writable
- whether the database volume or bind mount still points to the intended location
- whether the filesystem has enough free space for the SQLite update

For source installs, you can rerun the migration step directly with:

```bash
pnpm migrate
```

Foldergram can automatically resume known migrations that were recorded before
their schema work began. If the log instead reports a partially present schema,
do not delete the database; restore a known-good `gallery.sqlite` backup and
retry the upgrade.

## Settings reports a permanent deletion recovery warning

Foldergram retries unfinished permanent deletions at startup and before later
maintenance work. If one journal cannot be restored or cleaned safely, its
quarantined files and journal are left untouched. The failure is logged and
shown in Settings, but it does not prevent the server from starting or the rest
of the library from being used.

Do not manually delete the named journal or quarantine files unless you have
first decided whether the affected post should be restored or permanently
removed. A later recovery attempt can still use those files.

## Nothing is being indexed

Start with the gallery structure rules:

- files directly inside `GALLERY_ROOT` are ignored
- hidden folders are ignored
- a folder is indexed when it directly contains supported media
- in reserved carousel mode, a folder is also indexed when `carousels/` has an immediate child containing supported media directly

This will not be indexed:

```text
gallery/
  loose-file.jpg
  trips/
    oslo/
      notes.txt
```

This will be indexed:

```text
gallery/
  trips/
    oslo/
      IMG_0001.jpg
```

## Rescan returns a rebuild-required message

This happens when the configured gallery root no longer validates against the
existing indexed library.

If you moved the same library to a new location and every indexed file still
exists at the same relative path with the same size, mtime, and extension,
Foldergram refreshes stored source paths automatically at startup and keeps the
existing index.

Use Settings or `POST /api/admin/rebuild-index` only when the new root is a
different or incomplete library, or when relocation validation already failed.

## Places do not appear

Places are opt-in and only work for photos that already have GPS metadata.

Check:

- `Settings -> Places` has prepared the offline GeoNames dataset
- `Settings -> Places` has run `Rebuild place assignments`
- the source photos actually contain GPS EXIF coordinates

Videos and photos without GPS metadata do not appear in Places.

## I moved files into different folders and expected them to stay the same post

After the derivative-layout upgrade migration has completed, full rescans can
preserve the same indexed row, likes, and derivative paths for safe file moves.

Check:

- that a full scan has already completed since the upgrade
- that the moved file kept the same size and modification time
- that the old source path is genuinely gone, not duplicated

If a move is ambiguous, Foldergram falls back to the older delete-and-new
behavior to avoid matching the wrong file.

## Old thumbnails or previews are still on disk after files disappeared

Missing originals are soft-deleted first. Stale derivatives are cleaned up only
after the retention window on a later successful full scan.

That is intentional so temporary share outages or accidental moves do not
immediately delete cached derivatives.

## A scan failed or completed with errors on a corrupt or unreadable media file

Foldergram can now handle this in two different ways, depending on
`SCAN_MEDIA_ERROR_MODE`.

Default behavior:

- `SCAN_MEDIA_ERROR_MODE=skip` reports supported-media failures and continues scanning the rest of the library
- the completed run is marked `completed_with_errors`
- `Settings -> Scan & Library` shows the admin-only report path for that run
- the full per-run report is written under `<DATA_ROOT>/scan-errors/`

Strict behavior:

- `SCAN_MEDIA_ERROR_MODE=fail` stops on the first supported-media failure and marks the scan as failed

This applies to supported media that reaches scan processing, including
supported images and videos. Unsupported extensions, excluded folders, hidden
paths, and files placed directly in `GALLERY_ROOT` are still ignored before
this stage.

## Moments are missing and highlights appear instead

That is expected when the library does not have enough EXIF-backed timestamps.

Foldergram switches to Highlights unless it has:

- at least `24` indexed posts
- at least `18` EXIF-backed posts
- at least `30%` EXIF coverage

## A folder named `stories` stopped appearing as a normal album

That is expected when Foldergram is using the default reserved-stories mode.

In that mode, `AppFolder/stories` is reinterpreted as folder-story data instead
of a standalone app folder.

If you want folders literally named `stories` to remain ordinary app folders:

1. open `Settings -> General Settings`
2. enable `Treat stories folders as normal app folders`
3. save the change
4. run a scan from `Settings -> Scan & Library`

## A folder is still showing up after I excluded it

Folder exclusions can come from:

- `GALLERY_EXCLUDED_FOLDERS` in `.env` or Docker Compose
- custom rules in `Settings -> General Settings`

Check:

- rules without a slash match folder names anywhere in the gallery tree
- rules with a slash match one exact relative path below `GALLERY_ROOT`
- env-backed rules require a restart to change
- custom rules require `Save changes`, then a full scan from `Settings -> Scan & Library`

If the folder was already indexed before the rule existed, it will stay visible
until that scan finishes and soft-removes it from the index.

## Videos or animated AVIF files fail to index or generate previews

Check that both tools are installed and available on `PATH`:

- `ffprobe`
- `ffmpeg`

Foldergram uses them directly for supported video files and animated AVIF
image-sequence processing. Static AVIF files use the normal image path and do
not require these tools.

## A video opens from the original file instead of a generated preview

That is a normal optimization. Foldergram streams the original file directly
when the video is already suitable for browser playback under the current size
and codec rules.

See [Media Processing](/media-processing) for the exact conditions.

## The development watcher is not reacting

The watcher is not a permanent always-on background process for every startup
path. It is development-only and is started by the scan and rebuild flows.

If needed:

1. run a manual scan from Settings
2. make your filesystem change again

## Likes disappeared after a rebuild

That is expected for `Rebuild Library Index`. The rebuild resets the indexed
library tables, including `likes`.

Thumbnail-only rebuilds do not clear likes.

## Docs build fails

Use the root command:

```bash
pnpm build:docs
```

If it fails, check for:

- broken internal links
- invalid frontmatter
- mistakes in `docs/.vitepress/config.ts`

## The app still behaves oddly in development after frontend changes

The client actively unregisters previously installed service workers in
development. Reload once after startup if you previously visited a production
build from the same origin and the browser still has stale cached assets.

## Carousel scan warnings and reconciliation recovery

Structural carousel warnings appear in **Settings → Scan & Library** without turning a successful scan into a processing failure. Move media placed directly in `carousels/` into a child folder; move nested media directly into that post child; split posts above 20 items; and expect a one-item child to become a normal post with a warning. If carousel children appear as ordinary folders, disable **Treat carousels folders as normal app folders**, save, then run **Scan Library**.

After changing the carousel folder setting, follow the pending update message in **Settings → Scan & Library**. Run **Scan Library** to apply the saved mode, or use **Rebuild Library Index** when Settings reports that a rebuild is required. The reminder remains visible until the index reflects the selected mode.

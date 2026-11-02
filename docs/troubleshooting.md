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

## Folders load but images or videos report permission denied

Files can be indexed even when the server cannot read their cached thumbnails
or previews. Check the API response or server log for `EACCES` and the affected
path. The server account needs read access to media files and read, write, and
directory traversal access to `THUMBNAILS_DIR` and `PREVIEWS_DIR`.

On Linux or WSL, if the server account owns the generated cache directories,
restore owner access with your configured paths:

```bash
chmod -R u+rwX /path/to/data/thumbnails /path/to/data/previews
```

This changes permissions on generated caches. It does not require rescanning
the library or rebuilding the database. If access is still denied on a
Windows-mounted drive, check the Windows permissions for those paths as well.

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

## Startup reports `database is locked` and the app keeps loading

This is a SQLite lock error. If it stops the API process, the development
client may also report `ECONNRESET` or `ECONNREFUSED` for `/api/` requests.

Close other Foldergram instances and database tools that have the same
`<DB_DIR>/gallery.sqlite` open, then restart Foldergram. A database viewer with
an unfinished read transaction can also block a write. Do not delete the
database or its journal files to clear a lock.

Foldergram allows up to five seconds for temporary SQLite locks during startup
migrations, startup schema checks, and normal database access. A persistent lock
can still prevent startup; close the process holding it before restarting.

Changing between Windows and WSL paths can trigger gallery relocation
validation even when both paths refer to the same library. Foldergram updates
the cached source paths in one transaction. A failed path update rolls back
the entire batch.

For WSL installations with recurring lock problems on a Windows-mounted drive,
you can keep the database on the Linux filesystem while leaving media on the
Windows drive. Stop all processes using the database, back it up, copy the
existing database to the new directory, and set `DB_DIR` in `.env` to that
directory before restarting. Preserve any `gallery.sqlite-wal`,
`gallery.sqlite-shm`, or `gallery.sqlite-journal` files with the database if
they remain after shutdown; do not copy an actively used database.

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
- a regular `.nofoldergram` file in a folder or any ancestor below `GALLERY_ROOT` excludes that entire subtree
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

Obsolete playable video previews for qualifying direct-playback videos are a
separate cleanup. **Scan and repair derivatives** removes them after validating
the current source, live derivative references, and active share requirements.
Quick scans do not remove them.

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

## A video preview fails or an old cached preview will not play

For source installs, make sure both `ffmpeg` and `ffprobe` are available to the
server process. Docker images include them.

Foldergram selects the first audio track whose codec has a decoder in the
installed FFmpeg build, skipping unsupported tracks before it. A video with
no audio remains silent. If audio exists but no track has an available decoder,
preview generation reports an error. Check the scan error report for details;
an available decoder does not guarantee that a damaged track can be decoded.

Empty cached thumbnails and previews are treated as missing. Run **Scan and
repair derivatives** to repair them in eager mode, or request the media again in
lazy mode. Nonempty corrupt or truncated previews still require forced
regeneration; Foldergram does not probe every cached video on each request.
**Regenerate Thumbnails** only rebuilds thumbnails and video posters, so it
does not repair a nonempty corrupt video preview.

A missing video preview is expected for a qualifying direct-playback video.
Normal playback uses the original, and the old preview URL resolves to it.

See [Video preview generation](/media-processing#video-preview-generation)
for audio selection, output validation, and cache behavior.

## A video preview disappears after a repair scan

If the video qualifies for direct playback, its generated preview is no longer
needed for normal playback. **Scan and repair derivatives** removes only that
generated preview file after validating the source and share requirements.
Thumbnails, originals, and indexed identities are preserved.

If a folder share still needs scoped preview media, the preview is retained or
recreated. Enabling sharing later also works without a library rebuild because
the scoped share route can generate the required preview on authorized first
access.

If you later run an older Foldergram version that expects generated video
previews by default, use **Scan and repair derivatives** to regenerate them.
Lazy mode can also recover them on demand. Originals and indexed identities are
not affected.

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
- a regular file named exactly `.nofoldergram` inside the folder or an ancestor below `GALLERY_ROOT`

Check:

- rules without a slash match folder names anywhere in the gallery tree
- rules with a slash match one exact relative path below `GALLERY_ROOT`
- env-backed rules require a restart to change
- custom rules require `Save changes`, then a full scan from `Settings -> Scan & Library`
- `.nofoldergram` must be a regular file, rather than a directory or symlink; a marker directly in `GALLERY_ROOT` is ignored
- adding or removing markers triggers a debounced scan only in development mode; Docker and other production deployments require a manual full scan

If the folder was already indexed before the rule existed, it will stay visible
until that scan finishes and soft-removes it from the index.

If an expected folder is missing, check it and its ancestors for `.nofoldergram`,
as well as environment and Settings exclusions. Remove the marker and run a full
scan to restore matching index records. The same check applies to missing story
capsules and carousel posts.

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

The current policy requires a compatible `.mp4` with H.264 video, `yuv420p`
pixels, AAC or no audio, a known size of at most `24 MiB`, and a known
orientation-correct display width of at most `1500` pixels. Larger compatible
videos use a generated preview and can still offer the HD original switch.

Folder-share visitors never receive ordinary original access. Shared playback
continues to use scoped preview media, which may be generated even for a video
that normally plays from its original.

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

Structural carousel warnings appear in **Settings → Scan & Library** without turning a successful scan into a processing failure. Move media placed directly in `carousels/` into a child folder; move nested media directly into that post child; split posts above 20 items; and expect a one-item child to become a normal post with a warning. If carousel children appear as ordinary folders, disable **Treat carousels folders as normal app folders**, save, then run **Scan for changes**.

After changing the carousel folder setting, follow the pending update message in **Settings → Scan & Library**. Run **Scan for changes** to apply the saved mode, or use **Rebuild Library Index** when Settings reports that a rebuild is required. The reminder remains visible until the index reflects the selected mode.

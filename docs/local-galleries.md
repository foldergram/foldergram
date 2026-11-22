---
title: Local Galleries
description: Add multiple local gallery locations, configure Docker mounts, and manage source availability in Foldergram.
---

# Local galleries

Foldergram can index photos and videos from multiple folders or drives into
one combined browsing experience. Originals stay in their existing locations;
adding a source indexes files without copying or moving them.

## Your primary gallery

Your existing gallery appears automatically in **Settings → Sources** as
**Primary gallery**. Its root is set by `GALLERY_ROOT` or defaults to the
`gallery` folder in `DATA_ROOT`. The primary path remains managed by environment
configuration. Additional locations are stored in SQLite and require no changes
to `GALLERY_ROOT`.

## Add a local folder

1. Open **Settings → Sources** as an administrator.
2. Choose **Add local folder** and enter a name and an absolute server path.
3. Choose **Validate path** to check that Foldergram can access the location.
4. Choose **Save & Sync** to save the source and start indexing.

Foldergram indexes media in subfolders and skips media files directly in the
selected root. Each enabled source contributes to the combined feeds. Folders
with matching names in different sources remain distinct.

Use **Sync now** on a source to scan that location, or **Scan library** in
**Settings → Scan & Library** to scan all enabled local sources. Immich
connections have separate sync controls.

## Server paths and Docker mounts

On a native installation, use an absolute path the Foldergram process can read.
The path is resolved on the server running Foldergram. Photos on a different
computer must first be made available to that server; selecting a folder on the
browser's computer does not expose it to Foldergram.

In Docker, add a bind mount for each location alongside the existing volumes:

```yaml
volumes:
  # Keep the existing Foldergram volumes and add your locations:
  - /home/alex/Pictures:/sources/pictures:ro
  - /mnt/external/Photos:/sources/external:ro
```

The left side is the host path. The right side is the container path to enter in
Sources, such as `/sources/pictures`. After changing mounts, run
`docker compose up -d` to recreate the container with its updated configuration.
Docker Desktop users may need to share the host drive or folder with Docker
first. Mount external drives before starting or syncing Foldergram.

Your existing `GALLERY_ROOT` and database settings can remain in place. Keep
SQLite and the derivative directories writable. A read-only photo mount is
sufficient for indexing.

## Read-only originals, disabling, and removal

New locations default to read-only originals. This setting still allows
Foldergram metadata edits and moving an indexed post to Trash, while blocking
original-file deletion.

Disabling a source hides its content and shares while retaining its index and
saved state. Removing a source clears its index, saved associations, shares,
and derivatives. Original files stay on disk.

## Disconnected drives and empty locations

A disconnected drive retains its index and cached derivatives, while healthy
sources remain usable. Reconnect the drive and sync the same source to reuse
its indexed records and saved state.

If a previously populated location appears completely empty, check the mount
and sync again. Use **Confirm empty location** only after intentionally clearing
the folder. Foldergram cannot reliably detect every filesystem replacement or
disappearing nested mount.

Local and [Immich connections](./immich.md) to the same files can produce
duplicate posts. Choose one source for overlapping content, or use
[local folder exclusions](./configuration.md#excluded-folders) to skip the local
copy.

## Upgrading an existing installation

Back up the SQLite database and application state before upgrading, including
the Immich encryption key if used. Follow the
[database backup guidance](./configuration.md#filesystem-and-backup-requirements)
to keep a consistent copy.

The upgrade assigns existing records to the primary gallery while preserving
IDs, saved state, shares, and derivative paths. Deploy the updated server and
client together. To roll back, restore the pre-upgrade backup with the matching
older version.

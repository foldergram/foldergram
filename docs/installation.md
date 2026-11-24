---
title: Installation
description: Installation details, runtime expectations, and production build commands for Foldergram.
---

# Installation

## Recommended: Docker Compose

For most people, Docker Compose is the best way to install Foldergram.

It uses the pre-built container image and already includes the media tooling
needed for video support.

### 1. Create a working folder

Create a folder for Foldergram and move into it:

```bash
mkdir foldergram
cd foldergram
```

### 2. Create `docker-compose.yml`

Download the Compose file:

```bash
wget -O docker-compose.yml https://raw.githubusercontent.com/foldergram/foldergram/main/docker-compose.yml
```

### 3. Create your first gallery folder

Create a starter folder for your first indexed App Folder:

```bash
mkdir -p data/gallery/example-album
```

The layout should look like this:

```text
foldergram/
  docker-compose.yml
  data/
    gallery/
      example-album/
```

### 4. Add your media

Place photos and videos inside `data/gallery/example-album` or another folder
under `data/gallery`.

Foldergram ignores loose files placed directly in the gallery root, so use a
structure like this:

```text
data/
  gallery/
    trips/
      oslo/
        IMG_0001.jpg
        clip-01.mp4
    family/
      summer-2024/
        porch.webp
```

### 5. Start Foldergram

Run:

```bash
docker compose up -d
```

Container startup runs pending SQLite migrations automatically before the app
opens the library database.

### 6. Open the app

Open:

- `http://localhost:4141`

For a quick backend check, you can also open:

- `http://localhost:4141/api/health`

The default Compose file uses the GHCR image and exposes `4141:4141`. If you
need a different host port, edit the left side of that mapping in
`docker-compose.yml`.

Starting with version `1.4.0`, releases are also published to Docker Hub. To
use Docker Hub, change the `foldergram` service's `image` in
`docker-compose.yml`:

```yaml
image: sajjadalis/foldergram:latest
```

Use a version tag such as `sajjadalis/foldergram:1.4.0` to select a specific
release. Earlier versions remain available on GHCR.

In the default Docker Compose setup, the container uses the image's built-in
production defaults plus the mounted `./data/...` volumes. The source-install
`.env` file is not read directly inside the container.

The shipped Compose file uses streaming for new local videos and keeps the
temporary video cache in `./data/hls-cache` on the host. See the
[video playback settings](./configuration.md#video-playback) for the available options.

It also sets `IMAGE_DETAIL_SOURCE: preview` and `DERIVATIVE_MODE: eager`.

If you want lazy derivatives or original-backed image detail pages, edit those
values in `docker-compose.yml` before starting the container.

To skip specific source folders from the first scan in Docker, add
`GALLERY_EXCLUDED_FOLDERS` under the Compose `environment:` block. For example:

```yaml
GALLERY_EXCLUDED_FOLDERS: "@eaDir,thumbnails,Archive/cache"
```

For an optional read-only public demo in Docker, add `PUBLIC_DEMO_MODE: "1"`
under the Compose `environment:` block. If the browser-visible origin differs
from the upstream Node host, also set `CSRF_TRUSTED_ORIGINS` to that public
origin.

If the app will be reachable from other devices on your network, enable the
admin password from the Settings page after first startup. You can then keep
the app admin-only, add a separate viewer password, or switch to public browse
mode with admin unlock.

See [Configuration](./configuration.md) for the full environment reference
and [Settings sections](./configuration.md#settings-sections) for app preferences
and maintenance actions.

## If you already cloned this repository

This repository includes:

- `docker-compose.yml` for the GHCR image
- `docker-compose.local.yml` as a local-build override

From the repo root, run:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

This command uses the normal runtime settings, but builds the image locally
from the repository `Dockerfile`.

## Source install for development

Use the source install when you want to develop Foldergram itself.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

See [Development](./development.md) for local ports, workspace commands,
tests, and documentation builds.

## Runtime requirements for source installs

| Requirement | Why it matters |
| --- | --- |
| Node.js 22 | Use 22.23.4 or a newer patched Node.js 22 release. The Docker image bundles Node.js 22.23.4. |
| `pnpm` | Matches the workspace scripts and lockfile. |
| Writable local storage | Foldergram creates and maintains the gallery, database, thumbnails, and previews directories. Keep `DB_DIR` on a local filesystem inside the host; WAL mode requires reliable local file locking. |
| FFmpeg and FFprobe | Install both for local video playback and animated AVIF processing. Foldergram uses FFprobe to inspect files and FFmpeg to make posters, previews, and streaming segments. The Docker image includes both. |

## Supported media

### Images

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.avif`

### Videos

- `.mp4`
- `.mov`
- `.m4v`
- `.webm`
- `.mkv`

## Default local paths and scan rules

The shipped `.env.example` points at:

| Variable | Default |
| --- | --- |
| `DATA_ROOT` | `./data` |
| `GALLERY_ROOT` | `./data/gallery` |
| `GALLERY_EXCLUDED_FOLDERS` | empty |
| `DB_DIR` | `./data/db` |
| `THUMBNAILS_DIR` | `./data/thumbnails` |
| `PREVIEWS_DIR` | `./data/previews` |
| `HLS_CACHE_DIR` | `<DATA_ROOT>/hls-cache` |
| `SCAN_MEDIA_ERROR_MODE` | `skip` |

`DATA_ROOT` is the base path for this layout. If you change only `DATA_ROOT`,
Foldergram uses `gallery`, `db`, `thumbnails`, `previews`, and `hls-cache`
under that directory unless you override those paths individually.
Full scan error reports are written under `<DATA_ROOT>/scan-errors/` when skip
mode records supported-media failures.

`GALLERY_EXCLUDED_FOLDERS` accepts comma-separated folder rules. Names match
any folder with that name anywhere in the gallery tree; values with a slash
match one exact relative path below `GALLERY_ROOT`.

Foldergram resolves relative paths from the repository root.

## Production behavior

### Docker

The Docker Compose install already runs the app in production mode.
The app inside the container listens on `4141` by default.

### Source

Build the server and client, then start the production server:

```bash
pnpm build
pnpm start
```

## Startup and upgrade behavior

Startup applies pending database migrations automatically. A new library is
scanned for the first time; an existing library reuses its saved index.

If the gallery location changes, Foldergram validates the new location before
scanning and may require a rebuild. See
[Gallery root changes](./configuration.md#gallery-root-changes) before moving
an existing library.

If the configured database directory is unavailable, Foldergram falls back to an
in-memory SQLite database. If the gallery, thumbnails, or previews directories
are unavailable, the library is reported as unavailable instead of serving stale
filesystem assumptions.

## Upgrading an existing installation

Keep your existing configuration, data directories, and volume mounts when
upgrading. Stop Foldergram before backing up its data so the SQLite backup is
consistent. Include the database, original gallery, and any other configured
data directories in the backup.

The database uses WAL mode, so a running instance may also have
`gallery.sqlite-wal` and `gallery.sqlite-shm` beside `gallery.sqlite`. A clean
shutdown checkpoints those files. Copy only `gallery.sqlite` after shutdown if
every other process and SQLite connection using the database is also closed. If
any connection remains open, or you snapshot a running system, include the
database and any live WAL sidecars together; do not copy only the main database
file. When shutdown reports `SQLite WAL checkpoint incomplete`, keep the WAL
sidecars with the backup. Keep `DB_DIR` on local storage rather than a network
share.

Videos already in your library keep their current playback after an update.
Use [preview cleanup](./media-processing.md#switch-existing-local-videos-to-streaming)
when you're ready to switch them to streaming.

### Docker Compose

Stop the app, then take the backup of the host directories mounted by Compose:

```bash
docker compose stop foldergram
```

Use the `latest` image tag in `docker-compose.yml` to follow stable releases:

```yaml
image: ghcr.io/foldergram/foldergram:latest
```

Pull the updated image and start the service again:

```bash
docker compose pull foldergram
docker compose up -d foldergram
docker compose logs --tail=100 foldergram
```

Pending SQLite migrations run automatically before requests are served. Check
the logs and open your existing library after startup.

If you keep an older Compose file, add this line under the `foldergram`
service's `volumes` to keep the streaming cache across container replacements.

```yaml
- ./data/hls-cache:/app/data/hls-cache
```

### Source installs

Stop the server and back up its configured data before updating the checkout
to the desired release. Then install the locked dependencies and rebuild:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

### Thumbnail and preview storage migration

When upgrading from the older thumbnail and preview layout, the next full
scan migrates existing generated files in place. Your library remains readable
during the migration, and original media files remain untouched.

Open **Settings → Scan & Library** and run **Scan for changes** to apply the
migration. See [Derivative mapping](/media-processing#derivative-mapping) for
the storage layout and repair behavior.

### Carousel folders when upgrading from v1.2.2

If the existing index contains folders named `carousels`, open
**Settings → General Settings** and choose **Use Carousel Posts** for the
reserved post structure or **Keep Normal Folders** to preserve the previous
folder behavior. Save the choice, then run **Scan for changes** from
**Settings → Scan & Library** to apply it. Use **Rebuild Library Index** only
when Settings requires it for a changed gallery location.

See [Carousel settings and migration](/carousel-posts#settings-and-migration)
for the folder rules and migration notices.

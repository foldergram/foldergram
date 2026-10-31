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

In the default Docker Compose setup, the container uses the image's built-in
production defaults plus the mounted `./data/...` volumes. The source-install
`.env` file is not read directly inside the container.

The shipped Compose file includes `IMAGE_DETAIL_SOURCE: preview` and
`DERIVATIVE_MODE: eager`.

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

The Settings sidebar separates app-wide preferences from maintenance actions:

- `General Settings` contains app language, stories and carousel folder modes, nested folder title format, excluded folders, Home/Reels defaults, and the default folder photo order
- `Places` contains offline place-data preparation and place-assignment rebuilds for GPS-tagged photos
- `Scan & Library` contains manual scan plus rebuild actions

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

`pnpm dev` and `pnpm start` both run pending SQLite migrations automatically
before the server opens the persistent database. Use `pnpm migrate` when you
want to apply pending migrations without starting the rest of the app.

The shipped `.env.example` keeps the development ports aligned like this:

- `DEV_CLIENT_PORT=4141` with client fallback through `4144`
- `DEV_SERVER_PORT=4140`

## Runtime requirements for source installs

| Requirement | Why it matters |
| --- | --- |
| Node.js 22 | Use 22.23.4 or a newer patched Node.js 22 release. The Docker image bundles Node.js 22.23.4. |
| `pnpm` | Matches the workspace scripts and lockfile. |
| Writable local storage | Foldergram creates and maintains the gallery, database, thumbnails, and previews directories. |
| FFmpeg and FFprobe | Needed only when you run the app outside Docker and want supported video processing or animated AVIF image-sequence processing. The backend calls `ffprobe` for metadata and `ffmpeg` for video thumbnails, video previews, and animated AVIF derivatives. |

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
| `SCAN_MEDIA_ERROR_MODE` | `skip` |

`DATA_ROOT` is the base path for this layout. If you change only `DATA_ROOT`,
Foldergram will look for `gallery`, `db`, `thumbnails`, and `previews`
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

The production app build is split from the docs build:

```bash
pnpm build
pnpm start
```

`pnpm build` builds:

- `server`
- `client`

It does **not** build the docs site.

### How production serving works

When `NODE_ENV=production`, the Express app serves `client/dist` if it exists.
Requests that do not start with `/api`, `/thumbnails`, or `/previews` fall back
to the SPA entry point.

## Docs build

The VitePress site is built separately:

```bash
pnpm build:docs
```

The deploy workflow publishes `./docs/.vitepress/dist`.

## Optional developer entry points

```bash
pnpm dev:server
pnpm dev:client
pnpm dev:docs
```

## Startup and upgrade behavior

On startup, the server checks storage availability and then decides whether to:

- apply pending SQLite migrations before opening the persistent app database
- queue a startup scan for first-run indexing
- keep using the existing index for already-initialized libraries
- validate a relocated gallery root and refresh stored source paths when it still matches the indexed library
- block scanning until a library rebuild happens only when the new gallery root does not validate against the current index

Fresh installs create `gallery.sqlite` from the baseline migration. Existing
supported installs are baselined automatically on the first upgraded start, so
later releases can apply ordered schema changes without a manual export or
rebuild step.

When a full library task runs, the UI reports discovery separately from later
media-processing phases so long-running maintenance work stays understandable.

If the configured database directory is unavailable, Foldergram falls back to an
in-memory SQLite database. If the gallery, thumbnails, or previews directories
are unavailable, the library is reported as unavailable instead of serving stale
filesystem assumptions.

## Upgrading an existing installation

Keep your existing configuration, data directories, and volume mounts when
upgrading. Stop Foldergram before backing up its data so the SQLite backup is
consistent. Include the database, original gallery, and any other configured
data directories in the backup.

### Docker Compose

Stop the app, then take the backup of the host directories mounted by Compose:

```bash
docker compose stop foldergram
```

To pin this release, set the service image in `docker-compose.yml` to:

```yaml
image: ghcr.io/foldergram/foldergram:1.3.0
```

The default `latest` tag follows stable releases. Pull the selected image and
start the service again:

```bash
docker compose pull foldergram
docker compose up -d foldergram
docker compose logs --tail=100 foldergram
```

Pending SQLite migrations run automatically before requests are served. Check
the logs and open your existing library after startup.

### Source installs

Stop the server and back up its configured data before updating the checkout
to the desired release. Then install the locked dependencies and rebuild:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

### Carousel folders when upgrading from v1.2.2

If the existing index contains folders named `carousels`, open
**Settings → General Settings** and choose **Use Carousel Posts** for the
reserved post structure or **Keep Normal Folders** to preserve the previous
folder behavior. Save the choice, then run **Scan Library** from
**Settings → Scan & Library** to apply it. Use **Rebuild Library Index** only
when Settings requires it for a changed gallery location.

See [Carousel settings and migration](/carousel-posts#settings-and-migration)
for the folder rules and migration notices.

---
title: Quick Start
description: Install Foldergram with Docker Compose and scan your first photo or video folder.
---

# Quick Start

Docker Compose is the recommended way to run Foldergram.

Install Docker with Compose support before following these steps. The image
includes the media tooling needed for video support and animated AVIF processing, so you do not
need to set up Node.js, `pnpm`, or `ffmpeg` on the host first.

## 1. Create your working folder

Create a folder for Foldergram and save the repository's
[docker-compose.yml](https://raw.githubusercontent.com/foldergram/foldergram/main/docker-compose.yml)
inside it. Open a terminal in that folder. The commands below run there.

Create a `data/gallery` folder for your media. The Compose file also mounts
directories for the database, thumbnails, previews, and video cache:

```text
data/
  gallery/
  db/
  thumbnails/
  previews/
  hls-cache/
```

## 2. Put media into folders under `data/gallery`

Foldergram does not index loose files placed directly in the gallery root.

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

Each folder that directly contains supported photos or videos becomes an
album. Nested media folders become separate albums. Once the basic gallery is
working, you can also add [carousel posts](./carousel-posts.md) or
[folder stories](./features.md#folder-stories-and-highlights).

## 3. Start the container

```bash
docker compose up -d
```

The included compose file:

- uses the GHCR image by default
- maps host port `4141` by default
- mounts `./data/gallery`, `./data/db`, `./data/thumbnails`, `./data/previews`, and `./data/hls-cache`
- runs the app in production mode
- uses internal container paths under `/app/data`
- relies on the image's bundled `ffmpeg` and `ffprobe`

Container startup also runs pending SQLite migrations automatically before the
app opens the persistent database.

For the default Docker Compose setup, the container uses the image's built-in
production defaults plus the mounted `./data/...` volumes. The source-install
`.env` file is not read directly inside the container.

The shipped Compose file sets `IMAGE_DETAIL_SOURCE=preview` and
`DERIVATIVE_MODE=eager`.

If you want Docker to skip specific source folders from the start, also add
`GALLERY_EXCLUDED_FOLDERS` in `docker-compose.yml`, for example:

```yaml
GALLERY_EXCLUDED_FOLDERS: "@eaDir,thumbnails,Archive/cache"
```

For an optional read-only public demo in Docker, add
`PUBLIC_DEMO_MODE="1"` under the Compose `environment:` block. If the
browser-visible origin differs from the upstream Node host, also set
`CSRF_TRUSTED_ORIGINS` to that public origin.

If you cloned the repo and want to build locally instead, use:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

## 4. Open the app

- `http://localhost:4141` for the app
- `http://localhost:4141/api/health` for a quick backend check

On first run, the server performs a startup scan because there is no existing
index. Existing libraries keep using the current index on startup; run
**Scan for changes** from Settings whenever you want to refresh the library after
changes.

To include supported local HEIC and HEIF photos, turn on **Import HEIC/HEIF photos**
in **Settings → Scan & Library**, then choose **Scan for changes**.
See [supported inputs](./media-processing.md#experimental-local-heic-and-heif).

On later upgrades, startup automatically applies pending SQLite migrations
before the app reuses the existing database.
See [Upgrading an existing installation](/installation#upgrading-an-existing-installation)
for backup, image-update, and Carousel migration steps.

For a large library, you can generate thumbnails and previews on demand instead
of preparing them during the scan. See
[detail source and derivative timing](./configuration.md#detail-source-and-derivative-timing)
before changing the Compose environment settings.

If you plan to expose Foldergram on a homelab or LAN, open Settings after the
first load and enable the admin password. From there, you can keep admin-only
access, add a separate viewer password, or switch to public browse mode.

Admins can also share one folder at a time from a folder page. Open a folder,
choose the Share button next to `Edit App Folder`, then create an expiring link,
an unlimited revocable link, or a reusable folder password. Shared visitors use
`/share/:slug` and stay limited to that folder.

Inside Settings:

- `General Settings` contains stories and carousel folder modes, nested folder title format, excluded folders, Home/Reels defaults, and the default folder photo order
- `Places` contains offline place-data preparation and place-assignment rebuilds for GPS-tagged photos
- `Scan & Library` contains the experimental HEIC/HEIF import setting, manual scans, and rebuild actions

If a scan finishes with skipped corrupt or unreadable supported media, the
admin scan panel shows the full report path for that run. Foldergram writes
those per-run reports under `<DATA_ROOT>/scan-errors/` and marks the run
`completed_with_errors`.

Until you enable password protection, Foldergram starts without an auth gate,
so Settings and the library-maintenance controls are available immediately to
whoever can reach the app.

## What to expect after startup

- Your albums and posts appear as the initial scan progresses. Large libraries can take time to finish.
- Thumbnails are generated under `data/thumbnails`; saved previews go under `data/previews`.
- In the default unprotected state, Settings is available immediately.
- After access protection is enabled, only admin sessions can open Settings or run scan and rebuild actions. Viewer and public sessions stay browse-only.
- Folder share links and folder passwords are read-only and scoped to one folder; they do not grant Settings, Home feed, Reels, Places, Likes, Collections, Trash, or original-file downloads.

If nothing appears, start with [Troubleshooting](/troubleshooting).

## Next steps

- [Add another local gallery](./local-galleries.md) or [connect Immich](./immich.md).
- [Configure Foldergram](./configuration.md) for your storage and media preferences.
- [Run from source](./installation.md#source-install-for-development) if you prefer a native installation.
- Follow [Development](./development.md) to work on code or documentation and prepare a pull request.

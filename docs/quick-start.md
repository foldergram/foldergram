---
title: Quick Start
description: Get Foldergram running locally with a real gallery structure and verified defaults.
---

# Quick Start

Docker Compose is the recommended way to run Foldergram.

It gives you the quickest path to a working install and includes the media
tooling needed for video support and animated AVIF processing, so you do not
need to set up Node.js, `pnpm`, or `ffmpeg` on the host first.

## Preferred: Docker Compose

## 1. Create your local data layout

```text
data/
  gallery/
  db/
  thumbnails/
  previews/
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

The important rule is simple:

- A non-hidden folder becomes an indexed album when it directly contains supported media.
- In reserved carousel mode, it can instead qualify when `carousels/` has an immediate child containing supported media directly; carousel-only albums do not need a placeholder file.
- Nested folders become separate albums if they directly contain media.

Optional: add folder stories and highlights with a reserved `stories/` folder:

```text
data/
  gallery/
    AnimalPlanet/
      post-1.jpg
      stories/
        story-1.mp4
        story-2.jpg
        Lions/
          clip-1.mp4
          nested-1/
            clip-2.jpg
```

In the default mode:

- direct media inside `AppFolder/stories` powers the folder avatar story
- each direct child folder under `stories/` becomes one highlight circle
- nested folders stay inside that same highlight capsule

If you need folders literally named `stories` to behave like normal app
folders, open `Settings -> General Settings`, enable `Treat stories folders as
normal app folders`, then run a rescan from `Settings -> Scan & Library`.

## 3. Start the container

```bash
docker compose up -d
```

The included compose file:

- uses the GHCR image by default
- maps host port `4141` by default
- mounts `./data/gallery`, `./data/db`, `./data/thumbnails`, and `./data/previews`
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
`Scan Library` from Settings whenever you want to refresh the library after
changes.

On later upgrades, startup automatically applies pending SQLite migrations
before the app reuses the existing database.
See [Upgrading an existing installation](/installation#upgrading-an-existing-installation)
for backup, image-update, and Carousel migration steps.

If you want the lowest upfront derivative work for a large library in Docker,
edit `docker-compose.yml` before startup:

```bash
IMAGE_DETAIL_SOURCE=original
DERIVATIVE_MODE=lazy
```

That combination keeps image detail pages on originals and generates missing
thumbnails or previews only when they are first requested.

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
- `Scan & Library` contains manual scan plus rebuild actions

If a scan finishes with skipped corrupt or unreadable supported media, the
admin scan panel shows the full report path for that run. Foldergram writes
those per-run reports under `<DATA_ROOT>/scan-errors/` and marks the run
`completed_with_errors`.

Until you enable password protection, Foldergram starts without an auth gate,
so Settings and the library-maintenance controls are available immediately to
whoever can reach the app.

## Optional: run from source for development

Foldergram is a `pnpm` workspace monorepo with three workspaces:

- `server`
- `client`
- `docs`

Use the source workflow when you want to develop or modify the app itself.

### Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 22 | Use 22.23.4 or a newer patched Node.js 22 release. |
| `pnpm` | Matches the workspace scripts and lockfile. |
| FFmpeg and FFprobe | Required on the host if you run the app outside Docker and want video support. |

### Development startup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` includes the same automatic migration step before the server opens
the database.

This runs:

- the Vite client on `http://localhost:4141`, with automatic fallback through `4144`
- the Express server on `http://localhost:4140`
- the VitePress docs site on `http://localhost:4145`, with automatic fallback to the next free port

## Useful commands

```bash
docker compose up -d
docker compose down
pnpm migrate
pnpm rescan
pnpm test
pnpm build
pnpm start
pnpm build:docs
```

## What to expect after startup

- Feed, folder pages, likes, explore, and moments read from SQLite, not directly from disk.
- Thumbnails are generated under `data/thumbnails`.
- Previews are generated under `data/previews`.
- In the default unprotected state, Settings is available immediately.
- After access protection is enabled, only admin sessions can open Settings or run scan and rebuild actions. Viewer and public sessions stay browse-only.
- Folder share links and folder passwords are read-only and scoped to one folder; they do not grant Settings, Home feed, Reels, Places, Likes, Collections, Trash, or original-file downloads.

If nothing appears, start with [Troubleshooting](/troubleshooting).

## Create a carousel post

Create `AppFolder/carousels/Trip/`, add `01-arrival.jpg`, `02-clip.mp4`, and `03-sunset.jpg`, then run a scan. The child becomes one swipeable post in filename order. See [Carousel Posts](/carousel-posts) for limits and edge cases.

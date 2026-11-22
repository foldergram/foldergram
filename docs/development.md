---
title: Development
description: Workspace scripts, local ports, watcher behavior, tests, and docs deployment details.
---

# Development

## Workspace layout

```text
.
├─ client/
├─ docs/
├─ server/
├─ data/
├─ scripts/
├─ package.json
└─ pnpm-workspace.yaml
```

## Root scripts

| Command | What it runs |
| --- | --- |
| `pnpm dev` | Server, client, and docs dev servers together |
| `pnpm dev:server` | Server only |
| `pnpm dev:client` | Client only |
| `pnpm dev:docs` | VitePress docs only |
| `pnpm build` | Server build plus client build |
| `pnpm migrate` | Run pending server database migrations without starting the app |
| `pnpm start` | Production server start |
| `pnpm build:docs` | VitePress docs build |
| `pnpm rescan` | Manual server rescan script |
| `pnpm test` | Server and client Vitest suites |
| `pnpm test:browser` | Client Chromium layout and contrast regressions |

## Default ports

| Service | Port |
| --- | --- |
| Vite client | prefers `4141`, with automatic fallback through `4144` |
| API server | `4140` |
| VitePress docs | prefers `4145`, with automatic fallback to the next free port |

## Dev proxy behavior

The Vite client proxies these paths to the backend:

- `/api`
- `/thumbnails`
- `/previews`

That keeps the browser pointed at the Vite dev server while backend assets still
come from Express.

The Vite client automatically stays within the reserved `4141-4144` range. That
lets it move off `4141` without stepping onto the backend or docs ports.

## Startup sequence

At boot, the server process:

1. runs Dbmate migrations for `gallery.sqlite`
2. creates the Express app
3. listens on `DEV_SERVER_PORT`
4. asks the scanner whether startup should scan, stay idle, or block for rebuild

If `DB_DIR` is unavailable, Foldergram keeps the existing fallback behavior:
it skips Dbmate for that run and uses an in-memory SQLite database instead.

If the scanner decides startup should be blocked because the gallery root
changed and relocation validation failed, Foldergram defers scanning until the
user performs a rebuild.

## Watcher behavior

The chokidar watcher is development-only.

Important detail:

- it is not part of request handling
- it is started by the admin scan and rebuild flows
- it batches changes with a `700ms` debounce window

Directory add/remove events force a full rescan. Media file changes and companion `.txt` or `.nfo` additions, edits, and removals are passed to the incremental scan path. Changes to companion files in reserved carousel or story folders fall back to a full rescan.

## Tests

The current automated tests are lightweight and focused on core invariants such as:

- scanner fingerprint behavior
- stable feed sort timestamp behavior
- folder slug generation
- derivative path generation
- Windows-style path normalization
- places, collections, trash, auth, and playback regressions across server and client behavior

Run them with:

```bash
pnpm test
```

Browser tests cover navigation, layout, and media playback. The streaming
tests use generated videos to check covers, Retry, seeking, and Reels swipes.
Install Chromium once, then run the suite.

```bash
pnpm --filter @foldergram/client exec playwright install chromium
pnpm test:browser
```

The suite builds the client and starts a temporary preview on `127.0.0.1:4173`.
It uses mock API responses, sample images, and a short video fixture with audio,
so it does not start the backend or read your gallery. Failure screenshots and traces are saved in
`client/test-results/`. To use an existing Chrome or Chromium installation, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path.

### Video streaming benchmark

With FFmpeg and FFprobe installed, run the benchmark from the repository root.

```bash
pnpm --filter @foldergram/server exec tsx test/video-streaming-benchmark.ts --smoke
```

The command makes a temporary library with generated videos and uses one
encoder. It measures database updates, page requests, preview cleanup, and
streaming starts and seeks. Omit `--smoke` to test with 50,000 photo records and
51 videos. Add `--output=/path/to/new-report.json` to save the results to a new file.

An example full run on an Intel Core i7-13700H with four visible CPUs and
FFmpeg 7.1.4 produced these results.

| What the benchmark measured | Example result |
| --- | ---: |
| Database upgrade from migration `000007` | 2.79 s |
| First feed, folder, and Reels requests | 352 ms, 1.09 s, 500 ms |
| Repeat requests for those pages, p95 | 412 ms, 626 ms, 519 ms |
| Check and remove 51 previews | 18.59 s to check, 9.54 s to remove |
| Time to decode the first frame, median / p95 | 590 ms / 1.44 s |
| Time to decode a frame after seeking, median / p95 | 546 ms / 645 ms |
| Finished cache size and peak Node.js memory | 5.16 MiB and 172 MiB |

In one smoke run, the median time to a decodable frame was **419 ms** with an
empty cache and **94 ms** after warming the first three seconds. Warmup took
**191 ms** at the median. These timings cover the server request and a frame
decoded by FFmpeg. Browser startup and real network latency are not included.

The browser suite runs in Chromium. Focused playback tests have also passed in
Firefox. Safari and physical mobile devices still need separate testing.

## Schema migrations

Foldergram keeps two schema references in sync:

- `server/src/db/schema.ts` for the current readable schema snapshot
- `server/db/migrations/*.sql` for ordered Dbmate migrations

When you change the schema:

- update `server/src/db/schema.ts`
- add a new SQL migration under `server/db/migrations`
- do not edit an already released migration; add a new one instead

Use `pnpm migrate` to apply pending migrations without starting the app.

## Client behavior worth knowing

- More → Display preferences applies browser theme choices immediately for admins and viewers, storing explicit System/Light/Dark overrides in `localStorage`; App default clears the override and follows the instance theme
- Settings → Appearance saves the instance default theme and accent color to the database; those saves preserve any current browser theme override
- explicit locale selection is stored in `localStorage`
- the saved app-language default is stored in the database and applies when no local browser override exists
- video mute preference is stored in `localStorage`
- Home's suggested-folders preference is stored in `localStorage` and can be changed immediately from More → Display preferences, including by viewers
- Home's independent fit-tall-media preference is also stored in `localStorage`, defaults to off, and applies to either desktop layout when enabled; hiding suggested folders only changes the feed width
- the client disables previously registered service workers in development
- the client registers `/sw.js` in production when the browser supports service workers

## Client localization

Foldergram's client locale files live in `client/src/locales/`.

- `en.json` is the canonical locale tree for app-owned UI copy
- `es.json`, `zh.json`, and `de.json` are shipped locales and must stay key-aligned with `en.json`
- `index.ts` resolves local overrides, saved app defaults, and browser locales, registers Vue I18n, and syncs `document.documentElement.lang`
- the client Vitest suite validates locale key parity against `en.json`

## Docs workflow

The docs workspace is standard VitePress:

```bash
pnpm dev:docs
pnpm build:docs
```

The release workflow in `.github/workflows/publish-ghcr.yml` runs when a tag
matching `v*.*.*` is pushed. After the Docker image is published successfully,
the docs job:

1. installs dependencies with `pnpm`
2. runs `pnpm build:docs`
3. publishes `./docs/.vitepress/dist`

## Production app behavior

In production mode, the Express app serves `client/dist` and falls back to the
SPA entry for non-API routes. Thumbnails and previews continue to be served as
static files from their configured directories.

## Carousel verification

Focused coverage lives in `server/test/carousel-posts-feature.test.ts` and `server/test/migration-bootstrap.test.ts`. Fixtures should cover reserved and legacy discovery, natural ordering, mixed media, warnings, the 20-item cap, stable post identity, post-wide mutations, and migration metadata preservation. Run server/client tests plus app and documentation builds before shipping carousel changes.

## Immich integration validation

Tests use an isolated temporary database/cache, an empty or fixture local gallery, and a fake Immich server. They cover multi-album identities, uploaded/external/shared assets, mixed and remote-only operation, scanner isolation, pagination/retries/partial failures, metadata overrides, moves/visibility/deletion/membership reconciliation, formats, ranges, cache access and mutation guards. Live v3.3.5 validation on 2026-11-13 imported 237 external assets (197 images, 40 videos) across 15 groups into an empty `data-test/gallery`, preserving the index after a local scan. All seven geotagged assets resolved to Places using a separate copy of the existing offline GeoNames dataset. Thumbnail/preview responses were WebP/JPEG, and two distinct video byte ranges returned HTTP 206 with exact lengths. The production index and gallery were untouched; no live albums or media were created or deleted.

Live validation must use a separate data root and an empty local gallery; never repoint the production index for testing.

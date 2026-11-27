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

If `DB_DIR` is unavailable, Foldergram skips migrations for that run and uses
an in-memory SQLite database instead.

If the scanner decides startup should be blocked because the gallery root
changed and relocation validation failed, Foldergram defers scanning until the
user performs a rebuild.

## Watcher behavior

Gallery watching is disabled by default, including in development. Set
`GALLERY_WATCH_ENABLED=true` to opt in to the development-only chokidar watcher.
When enabled, it starts after an admin scan or rebuild and batches changes with
a `700ms` debounce. It runs outside request handling. Production never starts
the watcher.

Directory additions and removals trigger a full rescan. Media changes and
companion `.txt` or `.nfo` additions, edits, and removals use the incremental
scan path. Companion file changes in reserved carousel or story folders fall
back to a full rescan.

## Tests

Run the server and client unit and integration tests from the repository root:

```bash
pnpm test
```

Browser tests run in Chromium and cover navigation, layout, and media
playback. Install Chromium once, then run the suite:

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

## Schema migrations

Foldergram keeps two schema references in sync:

- `server/src/db/schema.ts` for the current readable schema snapshot
- `server/db/migrations/*.sql` for ordered Dbmate migrations

When you change the schema:

- update `server/src/db/schema.ts`
- add a new SQL migration under `server/db/migrations`
- do not edit an already released migration; add a new one instead

Use `pnpm migrate` to apply pending migrations without starting the app.

## Client preferences and service workers

Browser preferences, including theme overrides, language, video mute state,
and Home display options, are stored in `localStorage`. Instance defaults for
theme, accent color, and app language are saved in SQLite. Browser theme and
language overrides take precedence over the corresponding instance defaults.

Development unregisters existing service workers to avoid stale assets.
Production registers `/sw.js` when the browser supports service workers.

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
matching `v*.*.*` is pushed. It builds `linux/amd64` and `linux/arm64` images
and publishes them to GHCR and Docker Hub. After publishing succeeds, the
workflow runs `pnpm build:docs` and deploys `docs/.vitepress/dist`.

## Production app behavior

In production mode, the Express app serves `client/dist` and falls back to the
SPA entry for non-API routes. Thumbnails and previews continue to be served as
static files from their configured directories.

## Carousel verification

Carousel regressions live in `server/test/carousel-posts-feature.test.ts`
and `server/test/migration-bootstrap.test.ts`. Changes should cover discovery,
item ordering, stable post identity, mutations, and metadata preservation
during migration.

## Immich integration validation

`server/test/immich-integration.test.ts` uses a fake Immich server and isolated
temporary storage. Use this fixture for changes to source synchronization,
media delivery, and failure handling.

For manual checks against a live Immich instance, use a separate data root
and an empty local gallery. Never point test runs at a production database
or gallery.

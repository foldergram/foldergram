---
title: Development
description: Set up a local checkout, run tests, and prepare code or documentation changes.
---

# Development

Use this guide to run Foldergram locally and test changes before opening a pull
request. For a self-hosted installation, follow [Installation](./installation.md).
Read [Contributing](https://github.com/foldergram/foldergram/blob/main/CONTRIBUTING.md)
for branch rules and changes that need discussion first.

## Set up a local checkout

You need Node.js 22 and the pnpm version pinned in the root `package.json`
(currently 10.28.0). Install FFmpeg and FFprobe to work on video playback,
animated AVIF processing, or the media integration tests.

From a fresh checkout, install the locked dependencies and create your local
configuration:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

If you already have a `.env`, keep it rather than copying over it. Use a
disposable gallery, database, and media caches for development. Check
`DATA_ROOT`, `GALLERY_ROOT`, `DB_DIR`, `THUMBNAILS_DIR`, `PREVIEWS_DIR`, and
`HLS_CACHE_DIR` before starting the server. The example sets some paths
explicitly, so changing `DATA_ROOT` alone may leave those overrides in place.

Start the development servers:

```bash
pnpm dev
```

| Service | Local address |
| --- | --- |
| App | `http://localhost:4141` |
| API | `http://localhost:4140` |
| Documentation | `http://localhost:4145` |

The app tries ports `4141` through `4144` if its preferred port is busy. The
docs server also chooses another port when needed; check the terminal for the
address. The app's development server forwards API and media requests to the
backend, so open the app address to test the UI.

Starting the server applies pending database migrations and scans a new
library. Existing libraries reuse their index. Read [Troubleshooting](./troubleshooting.md)
if startup fails or storage is unavailable.

## Find the code you need

| Path | Contents |
| --- | --- |
| `client/src/` | Vue components, views, stores, and API helpers |
| `client/src/locales/` | Translated UI text |
| `client/e2e/` | Playwright browser tests |
| `server/src/` | API routes, scanning, media processing, and storage services |
| `server/test/` | Server unit and integration tests |
| `docs/` | This VitePress documentation site |
| `scripts/` | Workspace commands and deployment scripts |

[How It Works](./how-it-works.md) explains indexing and media handling.
The [API reference](./api.md) documents requests, responses, and access rules.

## Run one development server

Use these commands from the repository root when you only need part of the
workspace:

| Command | Starts |
| --- | --- |
| `pnpm dev:server` | API server |
| `pnpm dev:client` | App development server |
| `pnpm dev:docs` | Documentation preview |

UI work normally needs both the client and server. Documentation work only
needs `pnpm dev:docs`.

## Refresh the development gallery

After adding or moving test media, open **Settings → Scan & Library** and run
**Scan for changes**. Gallery watching is off by default.

To scan automatically during development, set `GALLERY_WATCH_ENABLED=true` in
`.env` and restart the server. The watcher starts after an admin scan or
rebuild. Directory additions and removals trigger a full scan; ordinary file
changes use an incremental scan. Production does not start the watcher.

Use a disposable gallery when testing scans, rebuilds, source removal, or file
deletion. These actions can change indexed state or remove files.

## Run tests and builds

Run server and client tests together:

```bash
pnpm test
```

To work on one area, use `pnpm test:server` or `pnpm test:client`. You can also
run one test file, for example:

```bash
pnpm --filter @foldergram/server exec vitest run --config vitest.config.ts test/carousel-posts-feature.test.ts
pnpm --filter @foldergram/client exec vitest run src/api/http.test.ts
```

Server integration tests use temporary galleries and databases. Follow those
fixtures when adding tests that import server configuration or database code.
Keep server tests serialized because they change process environment and
module state. Immich tests use a fake server; they do not need a live instance.
Media tests can be skipped when FFmpeg or FFprobe is unavailable, so check the
test summary when verifying a media change.

For UI, navigation, theme, or playback changes, run the browser suite too:

```bash
pnpm --filter @foldergram/client exec playwright install chromium
pnpm test:browser
```

Playwright builds the client and starts a preview on `127.0.0.1:4173` with
mocked APIs. It does not need a running backend or access to your gallery.
Failure screenshots and traces are saved in `client/test-results/`. To use an
existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Before submitting app code, run `pnpm test` and `pnpm build`. For documentation
changes, run `pnpm build:docs` and check the links and examples you changed.
There is no configured lint or formatting command.

### Measure video streaming performance

With FFmpeg and FFprobe installed, run the small benchmark:

```bash
pnpm --filter @foldergram/server exec tsx test/video-streaming-benchmark.ts --smoke
```

It creates a temporary gallery and generated videos. Omit `--smoke` for the
larger workload of 50,000 photo records and 51 videos. Use
`--output=/path/to/new-report.json` to save the results.

## Change the database schema

Update `server/src/db/schema.ts` and add a new, ordered Dbmate migration under
`server/db/migrations/`. Never rewrite a released migration. Test a fresh
database and an upgrade from the previous schema, including preservation of
existing data.

Use `pnpm migrate` to apply pending migrations to your development database
without starting the app.

## Change UI text

Keep app-owned text in `client/src/locales/`. Add keys to `en.json` and keep
`de.json`, `es.json`, and `zh.json` aligned. Use the existing i18n helpers in
components, including for accessible labels. The client test suite checks
locale key parity.

Browser preferences, such as language, appearance, and video mute state, can
persist between local sessions. Check both browser overrides and saved app
defaults when testing preference changes. Development unregisters the production
service worker to prevent it from serving stale app files.

## Work on the documentation

Edit the Markdown files under `docs/` and preview them with `pnpm dev:docs`.
Run `pnpm build:docs` before submitting; the build checks internal links as well
as generating the site.

Write for the reader's task: explain what to configure or do, what result to
expect, and any relevant limitations. Keep user guides focused on operating
Foldergram. Use the API and architecture references for technical detail that
helps integrations or code changes.

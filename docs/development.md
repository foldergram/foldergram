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

Directory add/remove events force a full rescan. File-level changes are passed to
the incremental scan path.

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

- theme selection is stored in `localStorage`
- explicit locale selection is stored in `localStorage`
- the saved app-language default is stored in the database and applies when no local browser override exists
- video mute preference is stored in `localStorage`
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

The deploy workflow in `.github/workflows/deploy-docs.yml`:

1. installs dependencies with `pnpm`
2. runs `pnpm build:docs`
3. publishes `./docs/.vitepress/dist`

## Production app behavior

In production mode, the Express app serves `client/dist` and falls back to the
SPA entry for non-API routes. Thumbnails and previews continue to be served as
static files from their configured directories.

## Carousel verification

Focused coverage lives in `server/test/carousel-posts-feature.test.ts` and `server/test/migration-bootstrap.test.ts`. Fixtures should cover reserved and legacy discovery, natural ordering, mixed media, warnings, the 20-item cap, stable post identity, post-wide mutations, and migration metadata preservation. Run server/client tests plus app and documentation builds before shipping carousel changes.

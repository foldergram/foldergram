# Architecture boundaries

Foldergram remains a modular monolith. Migration is incremental: existing behavior and public HTTP contracts stay stable while code moves behind business-module entry points.

## Server dependency direction

New server modules live under `server/src/modules/<module>/` and expose their public API from `index.ts`.

```text
routes -> application -> domain
                    \-> ports <- adapters
```

- `routes/` owns Express request parsing, capability checks, status codes, and response serialization.
- `application/` owns use cases and workflow orchestration.
- `domain/` owns pure business rules and must not import Express, SQLite, the filesystem, configuration, or process-global services.
- `ports/` declares the small capabilities a use case needs. Ports may use domain types.
- `adapters/` implements ports with SQLite, the filesystem/NAS, ffmpeg, clocks, random sources, logging, or remote workers.
- The application composition root creates adapters and injects them into use cases. Business modules must not import another module's internals; they import its `index.ts` only.

Existing `routes/`, `services/`, and `db/` code is migrated one vertical slice at a time. Compatibility exports are allowed only while callers are being moved and must not gain new behavior.

## Client dependency direction

New client modules live under `client/src/features/<feature>/` and expose their public API from `index.ts`.

```text
views -> features -> api/http
                 \-> shared types and utilities
```

- Route views compose features and stores; they do not implement request protocols.
- Feature UI renders state and forwards user intent.
- Feature state owns request lifecycle, cancellation, retries, and cross-view business state.
- API modules own HTTP paths, payloads, and response types; they do not import Vue components, views, or stores.
- Features must import another feature through that feature's `index.ts`, not an internal file.
- Shared utilities must remain independent of views and feature UI.

The existing player contract in `docs/player-contract.md` is stricter than these general rules and remains authoritative.

## Public module layout

Use only the directories needed by a module; do not create empty layers or one-to-one forwarding classes.

```text
server/src/modules/feed/
  index.ts
  routes/
  application/
  domain/
  ports/
  adapters/

client/src/features/feed/
  index.ts
  api/
  state/
  ui/
  domain/
```

Tests stay beside pure units when useful and in the existing package test locations for HTTP and integration contracts. A module's `index.ts` is its only cross-module import surface.

## Automated enforcement

`pnpm check:architecture` performs four checks without adding a dependency:

1. Circular relative imports in production TypeScript and Vue source. The current scanner/deletion/watcher cycle is an explicit migration baseline; any additional cycle fails the check.
2. Server and client module-layer dependency rules.
3. Cross-module imports that bypass a module's `index.ts`.
4. Line-count ceilings on legacy hotspots so migration reduces them instead of adding more responsibilities.

CI runs the architecture check before server tests, client tests, and the production build. The exact HTTP method/path registry is protected by `server/test/api-route-contract.test.ts`; route splitting may change files and Router composition, but not that registry unless an API change is intentional.

## Migration rules

- Keep each change deployable and reversible.
- Move behavior before redesigning it; preserve status codes, payloads, permissions, and side effects.
- Add ports only for real external variation or test isolation.
- Do not add a generic base repository or controller/service/manager forwarding chain.
- Remove compatibility exports after all callers migrate.

## Migration status (2026-09-11)

The four legacy hotspot files have been split behind compatible composition roots; every public export, caller import path, and HTTP contract is unchanged.

| Composition root | Lines | Domain files |
|---|---|---|
| `server/src/routes/api.ts` | 48 | `server/src/modules/{feed,library,folders,collections,places,sharing,deletion,settings,admin}/` |
| `server/src/db/repositories.ts` | 27 | `server/src/db/repositories/{media,collections,shares,settings,scans,shared}.ts` |
| `server/src/services/gallery-service.ts` | 70 | `server/src/services/gallery-service/{feed,folders,shares,places,collections,interactions,admin,shared}.ts` |
| `client/src/api/gallery.ts` | 13 | `client/src/api/gallery/{feed,moments,folders,places,stories,shares,posts,interactions,collections,trash,status,auth,admin}.ts` |

- `server/test/api-route-contract.test.ts` still locks all 102 method/path registrations against the composed router.
- Line-count ceilings in `scripts/check-architecture.mjs` were lowered to the actual composition-root sizes and now guard against regression.
- The remaining large files (`FeedCard.vue`, `ReelPlayerCard.vue`) are player-contract surfaces in `docs/player-contract.md` and are intentionally not split.

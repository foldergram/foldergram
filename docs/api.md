---
title: API
description: Backend endpoints, parameters, response shapes, and mutation rules in Foldergram.
---

# API

All documented routes come from `server/src/routes/api.ts`.

## Base paths

| Base path | Purpose |
| --- | --- |
| `/api` | JSON API |
| `/thumbnails` | Protected thumbnail derivatives, served from cache or generated on demand in lazy mode |
| `/previews` | Protected preview derivatives, served from cache or generated on demand in lazy mode |

## Authentication and protected routes

Foldergram can optionally require a role-bearing password session.

When password protection is enabled:

- most `/api` routes return `401` until the browser logs in, except for safe read routes in public viewer mode
- `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/unlock-admin`, and `POST /api/auth/logout` stay reachable without an authenticated session
- scoped `/api/share/...` routes stay reachable so folder-share visitors can unlock and read one shared folder
- `PUT /api/auth/password` is public only when password protection is currently disabled, so the first admin password can be set
- `/thumbnails/...` and `/previews/...` also require the same authenticated session unless public viewer mode is enabled
- authenticated sessions carry `admin` or `viewer` role data
- anonymous public reads use `role: "anonymous"` and `likesMode: "local"`
- anonymous public JSON responses omit local media paths, post source paths, and EXIF metadata at every carousel-item depth; `folderPath` remains available for folder display and `carouselTitle` provides the safe child-folder label used for carousel caption fallback
- admin-only mutations return `403` for viewer sessions

The frontend sends same-origin credentials automatically and uses a signed
cookie-based session.

## Mutation requirements

All mutating API routes are protected by `requireTrustedMutationRequest`.

### Required header

```http
x-foldergram-intent: 1
```

### Local-origin checks

For mutating requests:

- if `Origin` is present, it must be `localhost`, `127.0.0.1`, or `::1`
- in development and test, the origin port must match `DEV_SERVER_PORT` or the reserved dev-client range from `DEV_CLIENT_PORT` through `DEV_CLIENT_PORT + 3`
- in production, loopback origins are allowed and same-host origins are allowed when they match the host serving the app on `SERVER_PORT`
- if `Origin` is absent but `Referer` is present, the same loopback check is applied to the referer origin

The shipped frontend adds `x-foldergram-intent: 1` automatically for `POST`,
`PUT`, `PATCH`, and `DELETE` requests.

## Common error behavior

| Status | When it happens |
| --- | --- |
| `401` | Password protection is enabled and the request is not authenticated. |
| `400` | Validation or request-shape errors surfaced through the Express error handler. |
| `403` | Missing intent header, failed local-origin check, or a viewer session hitting an admin-only route. |
| `404` | Missing folder, post, moment, or original media. |
| `409` | A scan or thumbnail rebuild was requested while the library requires a library-index rebuild after a gallery-root change. |

## Read endpoints

### `GET /api/health`

Returns process-level health plus storage state.

Example shape:

```json
{
  "ok": true,
  "timestamp": "2026-03-16T12:34:56.000Z",
  "storage": {
    "available": true,
    "reason": null,
    "usingInMemoryDatabase": false
  }
}
```

### `GET /api/auth/status`

Returns the current auth state for the browser session.

Example shape:

```json
{
  "enabled": true,
  "authenticated": false,
  "role": "anonymous",
  "accessMode": "public",
  "likesMode": "local",
  "defaultLocale": "zh",
  "capabilities": {
    "canManageLibrary": false,
    "canDeleteMedia": false,
    "canAccessSettings": false,
    "canUseSharedLikes": false,
    "canUseLocalFavorites": true,
    "canUseSharedCollections": false,
    "canUseLocalCollections": true
  }
}
```

Notable field:

| Field | Notes |
| --- | --- |
| `defaultLocale` | Saved app-wide default locale used to localize the auth gate and other pre-auth UI when the browser does not already have its own local override. |

### `GET /api/feed`

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | integer | `1` | Minimum `1`. |
| `limit` | integer | `24` | Minimum `1`, maximum `60`. |
| `mode` | `recent | rediscover | random` | `random` | Home feed mode. |
| `seed` | integer | unset | Optional random seed for `random` mode. |

Response shape:

```json
{
  "mode": "recent",
  "items": [],
  "page": 1,
  "limit": 24,
  "total": 0,
  "hasMore": false
}
```

Notes:

- `items` contain both images and videos.
- `thumbnailUrl` points to `/thumbnails/...`.
- `previewUrl` points to `/previews/...`.
- feed items can include a nullable `caption`.
- feed items representing carousel posts include `carouselTitle`, a display-safe child-folder label that remains available when anonymous-public responses omit `sourcePath`.

### `GET /api/feed/search`

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | none | Required search text. |
| `page` | integer | `1` | Minimum `1`. |
| `limit` | integer | `24` | Minimum `1`, maximum `60`. |

Returns the same paginated mixed-media payload shape as `GET /api/feed`.

### `GET /api/reels`

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | integer | `1` | Minimum `1`. |
| `limit` | integer | `24` | Minimum `1`, maximum `60`. The current client helper requests `6` per page. |
| `mode` | `recommended | recent | random` | `recommended` | Reels queue mode. |
| `seed` | integer | unset | Optional seed used to keep `recommended` and `random` queues stable while paging. |
| `lastFolder` | string | unset | Optional recent-navigation hint used by `recommended`. |
| `recentFolders` | comma-separated string | unset | Optional recent-navigation hints used by `recommended`. |

Response shape:

```json
{
  "mode": "recommended",
  "items": [],
  "page": 1,
  "limit": 6,
  "total": 0,
  "hasMore": false
}
```

Notes:

- `items` contain videos only.
- `recommended` uses `lastFolder` and `recentFolders` to bias the queue toward folders you recently opened.
- `recent` ignores recommendation hints and returns newest indexed videos first.
- `random` and `recommended` stay stable across pages when the same `seed` is reused.

### `GET /api/feed/moments`

Returns the current Home Moments or Highlights definition.

The response can be:

- `moments`
- `highlights`

Response shape:

```json
{
  "railKind": "moments",
  "railTitle": "Moments",
  "railDescription": "Memory capsules shaped by real capture dates from your library.",
  "railSingularLabel": "Moment",
  "items": []
}
```

Each capsule item includes:

- `id`
- `title`
- `subtitle`
- `dateContext`
- `imageCount`
- `coverImage`

Date-driven Moment capsules also include `momentDate`, which carries the
server-selected calendar data the client uses for localization without
rebuilding the date windows locally.

`momentDate` can be:

- `{"type":"on-this-day","date":{"year":2026,"month":5,"day":31}}`
- `{"type":"this-week-previous-years","startDate":{"year":2026,"month":5,"day":24},"endDate":{"year":2026,"month":6,"day":7}}`
- `{"type":"from-last-year","referenceDate":{"year":2025,"month":5,"day":31},"startDate":{"year":2025,"month":4,"day":16},"endDate":{"year":2025,"month":7,"day":15}}`

Highlight capsules omit `momentDate`.

### `GET /api/feed/moments/:id`

Path parameters:

| Param | Type |
| --- | --- |
| `id` | string |

Query parameters:

| Param | Type | Default |
| --- | --- | --- |
| `page` | integer | `1` |
| `limit` | integer | `24` |

Returns `404` with `{"message":"Feed capsule not found"}` when the ID does not
exist in the currently selected set.

The `moment` object in the response uses the same capsule shape as
`GET /api/feed/moments`, including `momentDate` when the active rail is
date-driven Moments.

### `GET /api/folders`

Returns:

```json
{
  "items": []
}
```

Each item is a folder summary with:

- `id`
- `slug`
- `name`
- `description`
- `folderPath`
- `breadcrumb`
- `imageCount`
- `videoCount`
- `latestImageMtimeMs`
- `hasAvatarStory`
- `avatarImageId`
- `avatarUrl`

### `GET /api/folders/:slug`

Returns one folder summary.

The response uses the same shape as folder items from `GET /api/folders`,
including `hasAvatarStory` so the client can decide whether the folder avatar
should open a story entry point.

Errors:

- `404` with `{"message":"Folder not found"}` if the slug is missing

### `GET /api/folders/:slug/images`

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | integer | `1` | Minimum `1`. |
| `limit` | integer | `24` | Minimum `1`, maximum `60`. |
| `mediaType` | `image | video` | unset | Optional folder filter. |

Response shape:

```json
{
  "folder": {
    "id": 1,
    "slug": "oslo",
    "name": "oslo",
    "description": null,
    "folderPath": "trips/oslo",
    "breadcrumb": "trips",
    "imageCount": 12,
    "videoCount": 3,
    "latestImageMtimeMs": 1700000000000,
    "hasAvatarStory": false,
    "avatarImageId": 42,
    "avatarUrl": "/thumbnails/ab/abcd1234ef567890abcd1234ef567890.webp?v=4"
  },
  "items": [],
  "page": 1,
  "limit": 24,
  "total": 12,
  "hasMore": false
}
```

Errors:

- `404` with `{"message":"Folder not found"}`

Notes:

- results follow the current app-wide default folder image order
- that same order is reused by detail-view previous/next navigation within a folder

## Folder share endpoints

Folder share endpoints are scoped to one folder. They do not create admin or
viewer sessions and do not unlock normal library routes.

### `GET /api/share/folders/:slug/access`

Returns whether a shared folder exists, whether the current request already has
a valid grant, and whether a folder password is available.

Response shape:

```json
{
  "exists": true,
  "granted": false,
  "hasPassword": true,
  "publicAccess": false
}
```

### `GET /api/share/folders/:slug`

Returns the shared folder summary after the request has access to that folder.

Access can come from:

- a valid admin or viewer session
- public viewer mode
- a valid folder-share link session
- a valid folder-password share session

Errors:

- `401` when the share is locked, expired, or revoked
- `404` when the folder does not exist

### `GET /api/share/folders/:slug/images`

Query parameters match `GET /api/folders/:slug/images`.

The response shape contains the shared folder summary and a list of redacted item payloads where media URLs point to grant-checking API endpoints:

- `thumbnailUrl`: `/api/share/images/:id/thumbnail`
- `previewUrl`: `/api/share/images/:id/preview`

Sensitive metadata including local folder paths, relative file paths, and EXIF metadata are omitted.

### `GET /api/share/posts/:postId`

Returns one shared post detail using the canonical `posts.id` namespace after
checking access to that post's folder. Shared folder grids and carousel links
use this route.

Shared detail payloads do not expose original-file URLs (`originalUrl`) or local system paths. Only `thumbnailUrl` and `previewUrl` are provided, both pointing to guarded shared media endpoints.

### `GET /api/share/images/:imageId`

Historical compatibility alias. The value is interpreted only as an
`images.id` and resolves through `post_items` to its owning post. Existing
single-image shared links continue to work. New shared links should use
`/api/share/posts/:postId`.

### `GET /api/share/images/:id/thumbnail`

Serves or lazily generates the thumbnail for one shared post after checking the
folder grant.

### `GET /api/share/images/:id/preview`

Serves or lazily generates the preview for one shared post after checking the
folder grant.

### `GET /api/places`

Returns:

```json
{
  "items": []
}
```

Each item is a place detail summary with:

- `id`
- `slug`
- `name`
- `kind`
- `isApproximate`
- `latitude`
- `longitude`
- `cityName`
- `admin1Name`
- `countryName`
- `countryCode`
- `description`
- `postCount`

### `GET /api/places/:slug`

Returns one place detail record using the same shape as a place item from
`GET /api/places`.

Errors:

- `404` with `{"message":"Place not found"}`

### `GET /api/places/:slug/images`

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `page` | integer | `1` | Minimum `1`. |
| `limit` | integer | `24` | Minimum `1`, maximum `60`. |
| `mediaType` | `image | video` | unset | Optional place filter. |

Response shape:

```json
{
  "place": {
    "id": 1,
    "slug": "oslo-norway",
    "name": "Oslo",
    "kind": "city",
    "isApproximate": false,
    "latitude": 59.9139,
    "longitude": 10.7522,
    "cityName": "Oslo",
    "admin1Name": "Oslo",
    "countryName": "Norway",
    "countryCode": "NO",
    "description": null,
    "postCount": 18
  },
  "items": [],
  "page": 1,
  "limit": 24,
  "total": 18,
  "hasMore": false
}
```

Errors:

- `404` with `{"message":"Place not found"}`

### `GET /api/folders/:slug/stories`

Returns the stories payload for one folder.

Response shape:

```json
{
  "railKind": "stories",
  "railTitle": "Stories",
  "railDescription": "Stories and highlights for AnimalPlanet.",
  "railSingularLabel": "Story",
  "hasAvatarStory": true,
  "avatarStoryId": "animalplanet-stories",
  "items": [],
  "highlights": []
}
```

Notes:

- `items` contains the avatar story first when one exists, followed by highlight capsules.
- `highlights` contains only highlight capsules.
- each capsule item includes `id`, `title`, `subtitle`, `dateContext`, `imageCount`, `coverImage`, `presentation`, and `latestActivityTimestamp`
- `presentation` is `avatar` or `highlight`
- `latestActivityTimestamp` is the latest effective media timestamp for that story capsule, exposed so clients can localize story activity labels without parsing the English fallback copy
- `avatarStoryId` can be a synthetic fallback id when the folder has highlight media but no direct avatar-story files

Errors:

- `404` with `{"message":"Folder not found"}`

### `GET /api/folders/:slug/stories/:id`

Path parameters:

| Param | Type |
| --- | --- |
| `slug` | string |
| `id` | string |

Query parameters:

| Param | Type | Default |
| --- | --- | --- |
| `page` | integer | `1` |
| `limit` | integer | `24` |

Response shape:

```json
{
  "railKind": "stories",
  "railTitle": "Stories",
  "railDescription": "Stories and highlights for AnimalPlanet.",
  "railSingularLabel": "Story",
  "story": {
    "id": "animalplanet-stories",
    "title": "AnimalPlanet",
    "subtitle": "AnimalPlanet story set",
    "dateContext": "Today",
    "latestActivityTimestamp": 1774713600000,
    "imageCount": 8,
    "presentation": "avatar",
    "coverImage": {}
  },
  "items": [],
  "page": 1,
  "limit": 24,
  "total": 8,
  "hasMore": false
}
```

Notes:

- the paginated `items` array contains normal feed-item payloads
- the `story` object uses the same capsule shape as `GET /api/folders/:slug/stories`, including `latestActivityTimestamp`
- if the requested avatar story is a fallback capsule, the server returns recent highlight media for that synthetic capsule

Errors:

- `404` with `{"message":"Story capsule not found"}`

### `GET /api/likes`

Returns:

```json
{
  "items": []
}
```

Items are ordered by like timestamp descending.

Notes:

- shared likes are available to `admin` and `viewer` sessions
- anonymous public sessions use browser-local favorites instead of this endpoint

### `GET /api/collections`

Returns:

```json
{
  "items": []
}
```

Each item includes:

- `id`
- `slug`
- `name`
- `isDefault`
- `itemCount`
- `coverImage`
- `previewImages`
- `createdAt`
- `updatedAt`

Notes:

- shared collections are available to `admin` and `viewer` sessions
- anonymous public sessions use browser-local collections instead of this endpoint
- the default saved collection is still represented in API data even though the UI surfaces it as `All Posts`

### `GET /api/collections/:slug/images`

Query parameters:

| Param | Type | Default |
| --- | --- | --- |
| `page` | integer | `1` |
| `limit` | integer | `24` |

Response shape:

```json
{
  "collection": {
    "id": 1,
    "slug": "saved",
    "name": "Saved",
    "isDefault": true,
    "itemCount": 12,
    "coverImage": null,
    "previewImages": [],
    "createdAt": "2026-03-16T12:34:56.000Z",
    "updatedAt": "2026-03-16T12:34:56.000Z"
  },
  "items": [],
  "page": 1,
  "limit": 24,
  "total": 12,
  "hasMore": false
}
```

Errors:

- `404` with `{"message":"Collection not found"}`

### `GET /api/trash/images`

This route is read-only but `admin`-only.

Query parameters:

| Param | Type | Default |
| --- | --- | --- |
| `page` | integer | `1` |
| `limit` | integer | `24` |

Response shape:

```json
{
  "items": [],
  "page": 1,
  "limit": 24,
  "total": 0,
  "hasMore": false
}
```

Each trash item uses the normal feed-item shape plus `trashedAt`.

That shared shape also includes the nullable `caption` field used by feed and
viewer surfaces.

### `GET /api/posts/:id`

Query parameters:

| Param | Type | Notes |
| --- | --- | --- |
| `mediaType` | `image | video` | Optional filter used by the viewer when switching between posts and reels. |

Returns one post detail payload with:

- feed-item fields
- `caption`
- `place` when the post has an assigned place
- `relativePath`
- `mimeType`
- `fileSize`
- `originalUrl`
- `playbackStrategy` for videos when an original MP4 is browser-compatible
- `nextPostId`
- `previousPostId`
- `nextImageId`
- `previousImageId`

`nextPostId` and `previousPostId` are the canonical post-navigation fields.
They are resolved within the same folder, the same active `mediaType` filter
when one is supplied, and the current default folder image order from Settings.
`nextImageId` and `previousImageId` are compatibility aliases with the same
values.

### `GET /api/posts/:id/collections`

Returns shared collection membership for one post.

Response shape:

```json
{
  "imageId": 42,
  "isSaved": true,
  "items": []
}
```

Each `items` entry uses the collection summary shape plus `containsImage`.

Errors:

- `404` with `{"message":"Post not found"}`

Detail media rules:

- if `IMAGE_DETAIL_SOURCE=original` and the item is an image, `previewUrl` points to `/api/originals/:id`
- videos keep `previewUrl` on `/previews/...`
- compatible original MP4 videos can set `playbackStrategy: "original"` so the client can expose an optional original-quality switch

Errors:

- `404` with `{"message":"Post not found"}`

### `GET /api/originals/:id`

Serves the original file from disk by image ID only.

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `download` | `1` | unset | When set to `1`, the server responds with an attachment using the indexed original filename. |

Rules:

- the indexed path must still exist
- the resolved path must stay within `GALLERY_ROOT`
- deleted posts do not resolve
- without `download=1`, the route streams the original inline/open behavior
- with `download=1`, the route serves the same file as a download attachment

Errors:

- `404` with `{"message":"Original media not found"}`

### `GET /api/status`

Returns viewer-safe operational state for the shell.

When access protection is enabled:

- `admin` and `viewer` sessions can always read it
- anonymous visitors can also read it when `viewer_access_mode=public`

Notable fields:

| Field | Notes |
| --- | --- |
| `folders` | Active indexed folders. |
| `indexedImages` | Active indexed posts. The name is historical and still includes videos in the total feed count. |
| `indexedVideos` | Active indexed videos only. |
| `scan` | Viewer-safe live scan progress snapshot. It uses the same shape as `GET /api/scan-progress`, with `currentFolder` and `currentFile` redacted and `lastCompletedScan.error_text` forced to `null`. Scan-report paths never appear here. |
| `storage` | Availability with a generic unavailable message only. |
| `libraryIndex` | Rebuild requirement plus ignored root-media count. Gallery-root paths are omitted. |
| `preferences.defaultLocale` | Saved app-wide default locale when configured. Browsers can still keep their own local override. |
| `preferences.defaultHomeFeedMode` | Current app-wide default home feed mode. |
| `preferences.defaultReelsFeedMode` | Current app-wide default reels mode used when `/reels` opens. |
| `preferences.defaultFolderImageOrder` | Current app-wide default order used for folder grids and folder detail navigation. |
| `preferences.treatStoriesAsFolders` | Whether folders literally named `stories` are treated as ordinary app folders instead of reserved story sources. |
| `preferences.treatCarouselsAsFolders` | Whether folders literally named `carousels` are treated as ordinary app folders instead of reserved carousel sources. |
| `storiesMigration` | Migration hint with `hasLegacyStoriesCandidates` and `decisionPending`. |
| `carouselsMigration` | Carousel migration state with `hasLegacyCarouselsCandidates`, `decisionPending`, and `reconciliationPending`. The last field remains true until a successful full scan applies the saved Carousel folder mode. |

### `GET /api/scan-progress`

Returns the standalone viewer-safe scan payload used for lightweight polling.

Access rules match `GET /api/status`:

- `admin` and `viewer` sessions can read it when access protection is enabled
- anonymous visitors can also read it when `viewer_access_mode=public`

Notable fields:

| Field | Notes |
| --- | --- |
| `isScanning` | Whether a scan or rebuild is currently running. |
| `phase` | `idle`, `migration`, `discovery`, or `derivatives`. |
| `scanReason` | Current trigger such as startup, manual rescan, index rebuild, or thumbnail rebuild. |
| `currentPhaseMessage` | Short phase summary for the UI. |
| `currentOperation` | Current action label such as derivative repair, derivative move, metadata discovery, or derivative generation. |
| `migrationTotalRows` / `processedMigrationRows` | Progress through legacy derivative migration checks. |
| `migratedDerivativeFiles` / `repairedDerivativeFiles` / `missingDerivativeFiles` / `backfilledAssetKeys` | Migration counters for moved, repaired, missing, and backfilled assets. |
| `discoveredFolders` / `processedFolders` | Folder discovery counters. |
| `discoveredImages` / `processedImages` | Indexed-post discovery counters. |
| `queuedDerivativeJobs` / `processedDerivativeJobs` | Derivative job counters once the queue is known. |
| `generatedThumbnails` / `generatedPreviews` | Completed derivative outputs in the current run. |
| `currentFolder` / `currentFile` | Always `null` in this viewer-safe route. |
| `lastCompletedScan` | Latest completed scan summary with `error_text` forced to `null`. Runs can be `completed`, `completed_with_errors`, or `failed`. |

Notes:

- discovery remains open-ended while folders and media are still being found, so clients should treat that phase as indeterminate even though the counters continue to advance
- migration and derivative phases expose determinate totals once the work queue is known

### `GET /api/admin/scan-progress`

Returns the admin-detailed live scan payload.

This route is read-only but `admin`-only.

It uses the same overall shape as `GET /api/scan-progress`, with the following differences:

- `currentFile` and `currentFolder` are populated when the active operation can identify a source path
- `lastCompletedScan` is the full scan record, including `error_text`
- when a run finishes as `completed_with_errors`, `error_text` contains a short sample plus the full report path under `<DATA_ROOT>/scan-errors/`

### `GET /api/admin/stats`

Returns the full admin operational payload.

This route is read-only but `admin`-only. It extends `GET /api/status` with the
additional fields below and uses the same admin-detailed `scan` payload as
`GET /api/admin/scan-progress`:

| Field | Notes |
| --- | --- |
| `deletedImages` | Soft-deleted post count. |
| `thumbnailCount` | Actual generated thumbnail files currently present on disk. |
| `previewCount` | Actual generated preview files currently present on disk. |
| `storage.usingInMemoryDatabase` | Whether SQLite had to fall back to in-memory mode. |
| `libraryIndex.currentGalleryRoot` | Current configured gallery root. |
| `libraryIndex.previousGalleryRoot` | Prior configured gallery root when the root changed. |
| `libraryIndex.lastSuccessfulGalleryRoot` | Gallery root from the last completed successful scan. |
| `libraryIndex.legacyDerivativeMigrationPending` | Whether older mirrored derivatives still need a manual migration scan. |
| `libraryIndex.pendingDerivativeMigrationRows` | Count of indexed rows still pending legacy derivative migration checks. |
| `excludedFolders` | Env-backed, custom, and effective exclusion rules. |
| `deletionRecovery` | Failed permanent-deletion recovery count and admin-safe journal details. A failed journal remains quarantined and does not stop the server or scans. |
| `lastScan` | Last completed scan run. |

The same `preferences.treatStoriesAsFolders` and `storiesMigration` fields from
`GET /api/status` are also present here.

### `GET /api/admin/places/status`

This route is read-only but `admin`-only.

Response shape:

```json
{
  "prepared": false,
  "databasePath": "/path/to/geonames.sqlite",
  "metadata": null
}
```

When prepared, `metadata` includes `source`, `sourceUrl`, `importedAt`, and
`rowCount`.

## Mutating endpoints

### `POST /api/auth/login`

Body:

```json
{
  "password": "your-admin-or-viewer-password"
}
```

Success:

```json
{
  "ok": true,
  "auth": {
    "enabled": true,
    "authenticated": true,
    "role": "viewer",
    "accessMode": "password",
    "likesMode": "shared",
    "capabilities": {
      "canManageLibrary": false,
      "canDeleteMedia": false,
      "canAccessSettings": false,
      "canUseSharedLikes": true,
      "canUseLocalFavorites": false,
      "canUseSharedCollections": true,
      "canUseLocalCollections": false
    }
  }
}
```

Errors:

- `400` if password protection is not enabled
- `401` if the password is incorrect
- `403` when trust requirements are missing

### `POST /api/auth/unlock-admin`

Elevates the current browser into an admin session by verifying the admin
password.

This route stays reachable without an existing authenticated session so it can
be used from viewer mode and public mode.

Body:

```json
{
  "password": "your-admin-password"
}
```

Success:

```json
{
  "ok": true,
  "auth": {
    "enabled": true,
    "authenticated": true,
    "role": "admin",
    "accessMode": "public",
    "likesMode": "shared",
    "capabilities": {
      "canManageLibrary": true,
      "canDeleteMedia": true,
      "canAccessSettings": true,
      "canUseSharedLikes": true,
      "canUseLocalFavorites": false,
      "canUseSharedCollections": true,
      "canUseLocalCollections": false
    }
  }
}
```

Errors:

- `400` if password protection is not enabled
- `401` if the admin password is incorrect
- `403` when trust requirements are missing

### `POST /api/auth/logout`

Clears the current browser session cookie.

Success:

```json
{
  "ok": true,
  "auth": {
    "enabled": true,
    "authenticated": false
  }
}
```

### `PUT /api/auth/password`

Sets or changes the admin password.

Body when protection is disabled:

```json
{
  "password": "new-password"
}
```

Body when protection is already enabled:

```json
{
  "currentPassword": "old-password",
  "password": "new-password"
}
```

Notes:

- password minimum length is `8`
- `viewer` sessions receive `403`
- changing the password invalidates older sessions

### `DELETE /api/auth/password`

Disables password protection entirely.

Body:

```json
{
  "currentPassword": "current-password"
}
```

Errors:

- `400` if protection is already disabled
- `401` if the password is incorrect
- `403` if the current session is not `admin`

### `PUT /api/auth/viewer-access`

Configures viewer access mode.

Body for admin-only access:

```json
{
  "mode": "off"
}
```

Body for password-protected viewer access:

```json
{
  "mode": "password",
  "viewerPassword": "viewer-password"
}
```

Notes:

- `viewerPassword` is required when `mode=password`
- viewer and admin passwords must differ
- changing viewer access invalidates older sessions
- `mode=public` enables anonymous browsing immediately
- anonymous public sessions use local browser favorites and collections instead of shared `/api/likes` and `/api/collections`

### `PUT /api/admin/settings/home-feed-default`

Sets the default mode used when Home opens.

Body:

```json
{
  "defaultMode": "recent"
}
```

Allowed values:

- `recent`
- `rediscover`
- `random`

Success:

```json
{
  "defaultMode": "recent"
}
```

### `PUT /api/admin/settings/app-locale`

Sets the saved app-wide default language used by browsers that do not already
have their own local override.

Body:

```json
{
  "defaultLocale": "zh"
}
```

Allowed values:

- `en`
- `es`
- `zh`

Success:

```json
{
  "defaultLocale": "zh"
}
```

### `PUT /api/admin/settings/reels-feed-default`

Sets the app-wide default mode used when `/reels` opens.

Body:

```json
{
  "defaultMode": "recommended"
}
```

Allowed values:

- `recommended`
- `recent`
- `random`

Success:

```json
{
  "defaultMode": "recommended"
}
```

### `PUT /api/admin/settings/folder-image-order-default`

Sets the app-wide default order used by App Folder grids and folder-scoped
previous/next post navigation.

Body:

```json
{
  "defaultOrder": "newest"
}
```

Allowed values:

- `newest`
- `oldest`

Success:

```json
{
  "defaultOrder": "newest"
}
```

### `PUT /api/admin/settings/stories-mode`

Sets how folders literally named `stories` are interpreted.

Body:

```json
{
  "treatStoriesAsFolders": false
}
```

Success:

```json
{
  "treatStoriesAsFolders": false
}
```

Notes:

- `false` enables the default reserved-stories mode
- `true` keeps `stories/` folders behaving like ordinary app folders
- this endpoint only saves the setting; use `POST /api/admin/rescan` afterward, or `POST /api/admin/rebuild-index` when `libraryIndex.rebuildRequired` is true

### `PUT /api/admin/settings/excluded-folders`

Sets the runtime custom excluded-folder rules.

Body:

```json
{
  "rules": [
    "@eaDir",
    "Archive/cache"
  ]
}
```

Success:

```json
{
  "envExcludedFolders": [],
  "customExcludedFolders": [
    "@eaDir",
    "Archive/cache"
  ],
  "effectiveExcludedFolders": [
    "@eaDir",
    "Archive/cache"
  ],
  "requiresScan": true
}
```

### `PATCH /api/folders/:slug`

Updates the display metadata for one App Folder.

Body:

```json
{
  "name": "Trips",
  "description": "Weekend city breaks."
}
```

Errors:

- `404` with `{"message":"Folder not found"}`

### `POST /api/folders/:slug/cover`

Sets the folder avatar or cover image to a specific post that already belongs
to the same folder.

Body:

```json
{
  "imageId": 42
}
```

Success:

```json
{
  "ok": true
}
```

### `GET /api/admin/folders/:slug/share-links`

This route is read-only but `admin`-only.

Returns share-link and folder-password status for one folder.

Response shape:

```json
{
  "links": [],
  "password": {
    "enabled": false,
    "updatedAt": null
  },
  "publicFolderUrl": "/folders/oslo",
  "publicAccess": false
}
```

Each link item includes:

- `id`
- `folderId`
- `tokenPrefix`
- `expiresAt`
- `revokedAt`
- `createdAt`
- `lastUsedAt`
- `status` as `active`, `expired`, or `revoked`

The token hash is never returned.

### `POST /api/admin/folders/:slug/share-links`

Creates a read-only share link for one folder.

Body:

```json
{
  "expiresIn": "24h",
  "customExpiresAt": null,
  "unlimited": false
}
```

Allowed `expiresIn` values:

- `1h`
- `24h`
- `7d`
- `custom`
- `unlimited`

For `custom`, provide an ISO timestamp in `customExpiresAt`. `unlimited=true`
or `expiresIn=unlimited` creates a no-expiry link that can still be revoked.

Success:

```json
{
  "ok": true,
  "shareUrl": "/share/oslo#token=raw-token-shown-once",
  "link": {
    "id": 7,
    "folderId": 1,
    "tokenPrefix": "abcd1234",
    "expiresAt": "2026-06-11T12:00:00.000Z",
    "revokedAt": null,
    "createdAt": "2026-06-10T12:00:00.000Z",
    "lastUsedAt": null,
    "status": "active"
  }
}
```

The raw token appears only inside `shareUrl` in this creation response.

### `DELETE /api/admin/folders/:slug/share-links/:linkId`

Revokes one share link.

Success:

```json
{
  "ok": true,
  "link": {}
}
```

### `PUT /api/admin/folders/:slug/share-password`

Sets or changes a reusable folder password.

Body:

```json
{
  "password": "folder-password"
}
```

Notes:

- password minimum length is `8`
- changing the password invalidates older password-based share sessions
- the raw password is never returned or stored

### `DELETE /api/admin/folders/:slug/share-password`

Removes the reusable folder password and invalidates password-based share
sessions.

Success:

```json
{
  "ok": true,
  "password": {
    "enabled": false,
    "updatedAt": null
  }
}
```

### `POST /api/share/folders/:slug/unlock-link`

Verifies a raw share-link token and sets the separate `foldergram_share_session`
cookie.

Body:

```json
{
  "token": "raw-token-from-url-fragment"
}
```

Success:

```json
{
  "ok": true
}
```

Expired, revoked, or otherwise invalid links return `403`.

### `POST /api/share/folders/:slug/unlock-password`

Verifies a reusable folder password and sets the same share-session cookie.

Body:

```json
{
  "password": "folder-password"
}
```

Success:

```json
{
  "ok": true
}
```

### `PATCH /api/posts/:id/caption`

Updates the custom caption for one visible post.

Body:

```json
{
  "caption": "Weekend ferry ride."
}
```

Notes:

- admin-only
- `caption` is trimmed before save
- empty or whitespace-only input clears the custom caption back to `null`
- maximum custom caption length is `300`
- missing or non-visible posts return `404`

Success:

```json
{
  "ok": true,
  "image": {}
}
```

`image` contains the updated post payload so the client can refresh loaded
surfaces immediately.

### `POST /api/posts/:id/like`

Marks a post as liked.

Success:

```json
{
  "ok": true,
  "id": 42,
  "liked": true
}
```

Errors:

- `404` with `{"message":"Image not found"}` when the post does not exist or is deleted
- `403` when trust requirements are missing

### `DELETE /api/posts/:id/like`

Removes a like.

Success:

```json
{
  "ok": true,
  "id": 42,
  "liked": false
}
```

### `POST /api/posts/:id/save`

Adds a post to the default saved collection.

Success:

```json
{
  "ok": true,
  "imageId": 42,
  "isSaved": true
}
```

### `DELETE /api/posts/:id/save`

Removes a post from the default saved collection and clears any custom shared
collection memberships for that post.

Success:

```json
{
  "ok": true,
  "imageId": 42,
  "isSaved": false
}
```

### `POST /api/collections`

Creates a new shared custom collection.

Body:

```json
{
  "name": "Trip Picks"
}
```

Success:

```json
{
  "ok": true,
  "collection": {}
}
```

### `PATCH /api/collections/:slug`

Renames one shared custom collection.

Body:

```json
{
  "name": "Best of Summer"
}
```

Errors:

- `404` with `{"message":"Collection not found"}`

### `DELETE /api/collections/:slug`

Deletes one shared custom collection.

Deleting a custom collection does not unsave the underlying posts if they are
still present in the default saved collection.

### `POST /api/collections/:slug/posts/:id`

Adds a post to one shared collection.

Success:

```json
{
  "ok": true,
  "imageId": 42,
  "isSaved": true
}
```

### `DELETE /api/collections/:slug/posts/:id`

Removes a post from one shared collection.

If the target collection is the default saved collection, the server clears all
shared collection membership for that post.

### `POST /api/posts/:id/trash`

Moves a post into Trash without removing the original file from disk.

Success:

```json
{
  "ok": true,
  "id": 42,
  "folderSlug": "oslo"
}
```

### `POST /api/posts/:id/restore`

Restores a post from Trash.

Success:

```json
{
  "ok": true,
  "id": 42,
  "folderSlug": "oslo"
}
```

### `DELETE /api/posts/:id`

Permanently deletes every physical member of the post:

- each source file from disk
- each thumbnail derivative
- each preview derivative

A single-item post has one member; a carousel has all of its ordered members
removed. Files are quarantined before the post, its relationships, and folder
avatar state are updated in one database transaction. A pre-commit failure
restores the files and leaves the post unchanged. Interrupted operations are
recovered automatically without making a committed deletion visible again.

Success:

```json
{
  "ok": true,
  "id": 42,
  "folderSlug": "oslo"
}
```

Errors:

- `404` with `{"message":"Image not found"}`
- `403` for viewer sessions
- `403` when trust requirements are missing

### `DELETE /api/folders/:slug`

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `deleteSourceFolder` | boolean | `false` | Accepts `true` or `false`. |

When `deleteSourceFolder=false`:

- direct posts in that folder are permanently deleted
- child folders below that path are kept
- Foldergram tries to remove now-empty directories

When `deleteSourceFolder=true`:

- the source folder subtree is removed from disk
- matching derivative subtrees are removed
- all indexed child folders under that subtree are removed

Success shape:

```json
{
  "ok": true,
  "slug": "oslo",
  "deletedImageCount": 12,
  "deletedFolderCount": 1,
  "deletedSourceFolder": false
}
```

Errors:

- `404` with `{"message":"Folder not found"}`
- `403` for viewer sessions
- `403` when trust requirements are missing

### `POST /api/admin/rescan`

Runs a manual scan against the current library and then starts the development
watcher.

Success:

```json
{
  "ok": true,
  "lastScan": {
    "id": 7,
    "status": "completed",
    "scanned_files": 120
  }
}
```

Notes:

- in `SCAN_MEDIA_ERROR_MODE=skip`, a successful rescan can also return `"status": "completed_with_errors"` when supported media was skipped and reported

Errors:

- `409` with the library-rebuild-required message when the gallery root changed
- `403` for viewer sessions
- `500` for scan failures surfaced from the scanner

### `POST /api/admin/rebuild-index`

Stops the watcher, clears the indexed library tables, rescans the current
gallery root, and then restarts the watcher.

Matching cached derivatives already on disk are left in place and can be reused.
In `DERIVATIVE_MODE=lazy`, this rebuild does not pre-generate missing thumbnails
or previews.

This resets:

- `likes`
- `images`
- `folders`
- `folder_scan_state`
- `scan_runs`

Shared collection memberships tied to the old image rows are also removed as
part of the image reset.

### `POST /api/admin/rebuild-thumbnails`

Stops the watcher, clears the thumbnail cache, regenerates thumbnails and video
poster images from indexed media, and restarts the watcher.

It does **not** reset:

- previews
- likes
- folder records
- scan history

Errors:

- `409` with the library-rebuild-required message when a library-index rebuild is required
- `403` for viewer sessions

### `POST /api/admin/places/geodata/prepare`

Downloads and prepares the offline GeoNames dataset used for Places.

Success:

```json
{
  "ok": true,
  "status": {
    "prepared": true
  }
}
```

### `POST /api/admin/places/rebuild`

Rebuilds place assignments for already indexed photos using their stored GPS
metadata.

Success:

```json
{
  "ok": true,
  "processed": 120,
  "assigned": 84,
  "skipped": 36
}
```

## Client helpers

The frontend wraps these endpoints in `client/src/api/gallery.ts`.

Those helpers are the best reference for current client-side usage, including:

- default page sizes
- when `mediaType` is sent
- which routes are expected to return `items` arrays versus single objects

## Post-oriented carousel API

Feed and detail objects include `postType`, `itemCount`, ordered `mediaItems`, and a display-safe `carouselTitle`. Each member identifies its physical asset with `imageId`; original and derivative delivery remains asset-oriented. Canonical post routes are:

- `GET /api/posts/:id`
- `PATCH /api/posts/:id/caption`
- `GET /api/posts/:id/collections`
- `POST|DELETE /api/posts/:id/like`
- `POST|DELETE /api/posts/:id/save`
- `POST /api/posts/:id/trash` and `/restore`
- `DELETE /api/posts/:id`
- `GET /api/share/posts/:id`
- `POST|DELETE /api/collections/:slug/posts/:id`

- `POST /api/admin/settings/carousels-as-folders` (`{ treatCarouselsAsFolders: boolean }`)
- `POST /api/admin/settings/carousels-migration-decision` (`{ decision: 'restore' | 'carousels' }`)

Admin settings mutations for carousel mode store the mode and migration decision atomically, then return `200 OK` with updated `AppStats`. They do not start a library scan. Use `POST /api/admin/rescan` afterward to reindex folders and posts with the selected mode. When `libraryIndex.rebuildRequired` is true, use `POST /api/admin/rebuild-index` instead. Status keeps `carouselsMigration.reconciliationPending` true until a successful full scan records the selected mode as applied.

The matching `/api/images/:id` routes remain compatibility aliases and interpret
the number only as a physical `images.id`. They never fall back to a colliding
post ID. `/post/:id` is canonical in the browser, while `/image/:id` remains an
alias. Derivative routes remain image-oriented because they identify physical
media assets. Status responses distinguish `indexedPosts`, `indexedMediaAssets`,
`indexedCarousels`, and single-video `indexedVideos`; scan summaries may include
`warning_count` and `warning_text`. Carousel mode and migration state are
available in `preferences.treatCarouselsAsFolders` and `carouselsMigration`.

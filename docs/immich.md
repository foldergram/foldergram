# Immich integration

The optional, read-only Immich integration works alongside local folders. Existing installations need no Immich configuration. Local scanning and watching continue as before. Home, Library, Reels, Places, likes and saved collections use the same Foldergram index for both sources. An empty local gallery is supported; keep the database directory writable.

## Connect in Settings

1. Open **Settings → Sources** as an administrator. When password protection is disabled, the installation's existing open-admin policy applies. Enable an admin password before exposing management over an untrusted network.
2. Choose **Connect Immich**, enter the server URL without `/api` and an Immich **API key**, then choose **Continue**. Connection help includes the required key permissions and Docker URL guidance.
3. Choose **Folders**, **Albums**, or **Both**. All discovered external folder roots and owned/shared albums are checked initially. **Customize selection** opens automatically after the connection succeeds. Uncheck anything you want to exclude, search larger lists, or select/deselect an entire category. Each folder includes its subfolders. Overlapping detected roots are combined so unchecking a root excludes its subtree from folder mode. Selected albums can still include the same media. Library `assetCount` is ignored; counts come from paginated asset enumeration.
4. Choose **Connect and sync** to save the selection and start importing. Discovery alone does not save or import anything. Existing selections are preserved when editing or retesting; **Save and sync** applies changes. Configuration changes and key rotations require another successful sync before imported content becomes visible again. To change the URL or port, choose **Edit connection** on the source card, enter the new address and API key, then choose **Check connection** and **Save and sync**. You can reuse the same key if it still works at the new address. Foldergram checks indexed asset IDs before moving an existing source to a new address. Add a separate source for a different Immich library.
5. Watch progress and actionable errors on the source card. **Sync now** performs a complete reconciliation. **More options** contains the last sync time, disable, cache clearing and removal. **Advanced options** in the editor contains the source name, original downloads, manual roots/album IDs, directory exclusions, connection diagnostics and an optional sync interval of at least five minutes.

No albums is a valid state. Uploaded media can exist outside albums: **Uploads outside selected albums** in Customize selection adds an **Unfiled uploads** group. This option is initially checked only when uploads are the only available content (no discovered folders or albums). Otherwise it stays unchecked, so excluding an album does not bring its uploaded media back through this group. Enabling it includes uploads in unchecked albums as well as uploads with no album. Unfiled uploads does not expose Immich's internal storage directories.

The suggested mode uses detected external directories and accessible albums: external only → Folders; albums only → Albums; both → Both. You can override it. New connections start with everything checked. When editing an older connection, enabling a previously unused category (Folders or Albums) selects all its discovered items once. Explicit exclusions, including a deliberately empty category, are remembered across mode changes, saves and rechecking the connection. Newly created albums must be selected in the editor later. New subfolders inside a selected root are included on the next sync. If administrator library discovery is unavailable, detected external directories are selected instead; a library ID and absolute root can also be entered manually. Manual roots use exact path boundaries, including descendants, and remote directory exclusions use the same boundary rule. Headless environment bootstrap retains explicit selections as described below.

## Grouping and identity

| Mode | Foldergram groups |
| --- | --- |
| Folders | Every direct parent directory containing media inside selected external-library roots |
| Albums | Every selected owned or shared Immich album, including uploaded **and** external assets |
| Both | Both sets of groups, sharing the same indexed assets |

An asset has one identity per `(source_id, external_asset_id)` and one normal Home post. It appears in every selected album and, in Both mode, its external directory. Directory membership supplies canonical feed attribution when present; otherwise the first selected album supplies it. Folder pages, counts, cover validation, folder video filters, Reels affinity and share authorization include all memberships. Opening a remote post from a folder preserves that group for next/previous navigation and cover selection.

Album names, descriptions and covers follow Immich unless an administrator overrides the Foldergram name/description or cover. Caption edits, likes and saved collection membership stay local and survive synchronization while the Immich asset ID stays unchanged. A manual cover whose membership disappears falls back to the current album cover or newest member. Foldergram's global newest/oldest setting controls folder browsing order.

Remote directories named `stories` or `carousels` are ordinary groups. Local special-directory conventions are not applied. Albums become folder pages, not carousel posts. Immich favorites are not imported into Foldergram likes.

**Avoid overlapping datasets.** If Immich reads Foldergram's `data/gallery` through `/mnt/foldergram`, indexing that dataset twice creates duplicate posts. Choose one source for it: use an empty local gallery in an Immich-only deployment, exclude those local folders using **Settings → General Settings → Excluded source folders** / `GALLERY_EXCLUDED_FOLDERS`, or leave the overlapping Immich roots unselected. Sources includes an **Open folder exclusions** shortcut to the local rules. Save changes to local rules, then run a scan in **Scan & Library** to update the local index. Remote exclusions affect directory mode; explicitly selected albums can still contain those assets. Foldergram never merges records using names, filenames or similar paths.

External filesystem moves can produce **new Immich asset IDs**. Foldergram preserves identity across a move only if Immich preserves the ID; it does not attempt filename-based identity recovery.

## Permissions and supported versions

The integration targets the **Immich v3.3.x** API contract and was developed against the verified **v3.3.5** contract. Other major/minor versions are rejected with an actionable error. API responses and pagination cursors are checked; incompatible responses retain the previous index.

| Permission | Purpose |
| --- | --- |
| `server.about` | Required version check |
| `asset.read` | Required metadata search |
| `asset.view` | Required thumbnails, image previews, video posters and playback |
| `album.read` | Album discovery and album selections |
| `library.read` **and an administrator account** | Optional external-library discovery |
| `asset.download` | Optional original downloads, also gated by source configuration |

`GET /api/libraries` returning 403 does **not** mean the key is invalid. In v3.3.5 this operation requires an administrator as well as `library.read`. Non-admin accounts can use search-based directory discovery/manual roots; album mode does not require library discovery. Account ownership and sharing determine which assets can be searched. A fresh service account does not automatically inherit another user's external library.

Use the least-privileged account that can access the selected dataset. Keys are user scoped in Immich, not restricted to one Foldergram selection. Foldergram also enforces a fixed operation allowlist: selected GET endpoints and **POST `/api/search/metadata`**, which is a read operation. It never uploads, edits, trashes, deletes, or creates content in Immich.

## Docker networking and environment bootstrap

Use `http://localhost:2283` when Foldergram runs directly on the host that publishes Immich's default port. For a mapping such as `2282:2283`, use `http://localhost:2282` from that host. Inside a Foldergram container, `localhost` addresses that container. When the containers share a Docker network, use the Immich service hostname and its internal port, such as `http://immich-server:2283`. To reach host services, configure a host gateway route appropriate to your Docker installation. A reverse proxy URL can include a normal path prefix. Configure the final URL: redirects are rejected, and the API key is never forwarded to redirect destinations. TLS verification stays enabled; private CAs can be supplied with Node's `NODE_EXTRA_CA_CERTS`.

Settings is the default configuration authority. Optional environment configuration creates one explicitly marked, read-only **environment-managed** source; it does not override separate Settings-managed sources. The key-file option takes precedence over `IMMICH_API_KEY`. Removing `IMMICH_URL` disables this source and releases it to Settings management, retaining the index/cache until you remove it there.

```yaml
# Add to your Foldergram service and attach the appropriate shared Docker network.
environment:
  IMMICH_URL: http://immich-server:2283
  IMMICH_API_KEY_FILE: /run/secrets/immich_api_key
  IMMICH_SYNC_MODE: folders  # folders, albums, both
  IMMICH_ROOTS: '[{"libraryId":"your-library-uuid","path":"/mnt/photos"}]'
  IMMICH_ALBUM_IDS: ""       # comma-separated album UUIDs
  IMMICH_AUTO_SYNC: "true"
  IMMICH_SYNC_INTERVAL_MINUTES: "60" # 0 = manual
secrets:
  - immich_api_key
# At the Compose top level:
# secrets:
#   immich_api_key:
#     file: ./secrets/immich_api_key
```

Selections remain explicit for headless bootstrap: no roots and no albums imports nothing unless `IMMICH_INCLUDE_UNFILED=true`. `IMMICH_NAME` changes the display name; `IMMICH_ALLOW_ORIGINALS=true` enables originals when the key also has `asset.download`. Invalid or offline bootstrap does not prevent startup; inspect Sources for errors. Do not run Settings and environment sources against the same dataset unless duplication is intentional.

Credentials are AES-256-GCM encrypted in SQLite. A persistent random 32-byte server secret is created with mode `0600` at **`DB_DIR/immich-encryption.key`**. Back up and persist this file together with the database. To supply an external Docker secret, set `IMMICH_ENCRYPTION_KEY_FILE` to a file containing exactly 32 raw bytes. Keys are write-only in APIs and the UI, never included in media URLs or request logs. Losing the encryption secret requires restoring it or entering source API keys again; existing local media continues working.

## Media cache and access policy

Browsers request media from Foldergram. Immich media reuses Immich-generated thumbnails, image previews, video poster thumbnails and playback files. No original is downloaded to generate Foldergram derivatives. Returned formats are preserved, including JPEG previews and WebP thumbnails, with the actual Content-Type. Local media keeps the existing derivative pipeline.

Cache files live under **`DB_DIR/immich-cache/<source_id>`**, outside the public local derivative directories. Defaults:

| Setting | Default | Behavior |
| --- | --- | --- |
| `IMMICH_CACHE_MAX_MB` | 512 | Bounded derivative and metadata budget; eviction before reservation |
| `IMMICH_CACHE_TTL_HOURS` | 168 | Maximum age since fetch; expired content is fetched again |
| `IMMICH_FETCH_CONCURRENCY` | 4 | Media fetch slots, clamped to 1–16; queue limited to 100 |

Metadata requests have four independent concurrency slots. Retryable metadata HTTP failures use bounded retries with backoff. All syncs are complete enumerations, so membership changes are reconciled independently of asset update timestamps. All selected scopes must complete before a transaction replaces memberships and marks unseen remote assets unavailable. Interrupted pagination, protocol errors or temporary failures retain the previous usable index. No incremental watermark is used. Local rebuilds and relocation only affect local records.

Cache requests for identical media/ranges share pending work. Video ranges stream immediately with status, Content-Range, Content-Length, Accept-Ranges and relevant validators forwarded; seeking never requires a complete download. Exact range responses can be cached separately. Complete-file cache entries also serve arbitrary ranges. Full files and ranges are published only after completion using atomic renames and metadata; incomplete transfers are discarded. Client cancellation, backpressure and timeouts stop the upstream transfer. Files larger than a slot's share of the disk budget stream without caching. Originals stream without being cached.

A successful metadata sync changes the cache identity when Immich's update timestamp, checksum or thumbhash changes. The cache also caps entries at 10,000. Old entries are inaccessible through the new identity and evicted on subsequent cache writes. Expired entries, least recently used entries and abandoned partials are evicted during cache reservation. **Clear cache** explicitly removes a source's cache.

During an Immich outage, affected sources show **Immich is unavailable** with connection guidance and a **Retry** button on Home, Library, folder pages and the post viewer. Local content remains usable. Foldergram retains the last indexed metadata and cached derivatives, but pauses remote media delivery, including cache hits, while the source is unavailable. Connection checks run while browsing; views recover automatically after reconnection, or you can choose **Retry**. Every media request checks index visibility, source enablement and authentication/membership before looking at cache. A confirmed 401 revokes the source immediately, and access remains revoked through retries until a successful reconciliation. A media 403 makes the affected asset unavailable; a derivative 404 remains retryable because Immich may not have generated the file yet. A completed sync removes deselected, trashed, hidden/locked, removed or shared-away media/memberships from normal and shared access. Remote browser responses use `private, no-store`, so browser caching cannot bypass later checks.

Access and visibility changes in Immich become known at the next successful reconciliation (or a failed media request), not instantly through a push channel. Choose a suitable sync interval for your access policy. Outages do not delete indexed assets or break local content or server startup. Sync completion refreshes browsing views even if you have left Settings.

**Disable** immediately hides the source and denies its shared/cached media while retaining index, likes, saves and cache. **Enable and sync** restores selected content. **Remove** deletes that source's Foldergram index, likes, saved memberships, shares and cache, leaving Immich unchanged. Remote trash/permanent deletion is blocked on the server and hidden in the UI. Shared links provide derivatives; remote original downloads are available through ordinary authenticated/public-viewer access only, not folder share sessions.

## Supported limits

Full reconciliation stages metadata in memory before an atomic commit, with a safety limit of one million distinct selected assets. Large selections can consume substantial memory and briefly hold SQLite's writer during commit; use smaller selections and suitable schedules. One Foldergram server process should own a database. Album order follows Foldergram's global folder ordering setting. Source settings currently use English labels. Live Photos, stacks, people/tag import, city-name-only Places fallback, HLS manifests and browser-incompatible playback codecs are not supported. GPS Places uses Foldergram's prepared offline GeoNames dataset. Source configuration changes and key rotation hide stale content until successful sync.

Contract references: [v3.3.5 search DTO](https://github.com/immich-app/immich/blob/v3.3.5/server/src/dtos/search.dto.ts), [library controller](https://github.com/immich-app/immich/blob/v3.3.5/server/src/controllers/library.controller.ts), [external library move behavior](https://docs.immich.app/features/libraries/).

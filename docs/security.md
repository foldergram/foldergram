---
title: Security
description: The real security posture of Foldergram, including admin/viewer/public access control, mutation trust checks, and local-only caveats.
---

# Security

Foldergram is built for local-only and self-hosted browsing.
Its security model is intentionally narrow even though it now supports an
optional admin/viewer/public access gate for homelab and LAN use.

## What Foldergram assumes

- you run it on your own machine or behind a trusted local-network or reverse-proxy setup
- the app is not exposed directly to the public internet without additional protection
- the built-in auth story is a small role-based password gate, not a multi-user account system
- processes and accounts with write access to the configured gallery, thumbnail,
  and preview roots are trusted not to replace directories while Foldergram is
  performing a delete or recovery operation

## Password protection

Foldergram can optionally protect the library from the Settings page with:

- an `admin` password for full access
- an optional separate `viewer` password for browse-only access
- an optional `public` viewer mode for anonymous browsing with local favorites

When enabled:

- Foldergram stores one-way password hashes, salts, and session metadata in SQLite `app_settings`
- the browser unlocks access with a signed `HttpOnly` session cookie
- the session payload carries the current role (`admin` or `viewer`)
- `/api` routes require that session, except for `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/unlock-admin`, `POST /api/auth/logout`, and the scoped `/api/share/...` routes
- generated media under `/thumbnails` and `/previews` also require that session unless public viewer mode is enabled
- in `viewer_access_mode=public`, safe read routes and generated media can be browsed anonymously
- anonymous public JSON payloads omit local media paths, post source paths, and EXIF metadata, including nested carousel items
- anonymous public favorites stay in the browser and never write into SQLite likes
- authenticated API and media responses are marked `Cache-Control: no-store` and `Vary: Cookie`
- the production service worker skips caching protected thumbnail and preview responses
- admin-only routes reject `viewer` and `anonymous` sessions with `403` or `401` depending on auth state

Changing either stored password or the viewer-access mode rotates the session
version, which invalidates older sessions. Disabling password protection clears
the stored auth settings.

## Folder shares

Folder shares are narrower than viewer sessions. They grant read-only access to
one folder through `/share/:slug` and do not unlock Home, feed search, Reels,
Places, Likes, Collections, Trash, Settings, scans, rebuilds, caption editing, cover
editing, delete actions, or original-file downloads.

Shared visitors can read post captions. Shared responses omit local filesystem
paths, EXIF and location metadata, and original-file URLs.

Admins can create:

- expiring folder links
- unlimited folder links that can still be revoked
- reusable per-folder passwords

Share links and folder passwords are independent grants rather than layers of
the same grant. Visitors with an active link do not also need the folder
password. Revoking a link invalidates that link and its session, but visitors
who know the reusable folder password can still create a password session. To
remove both access paths, revoke the applicable links and change or remove the
folder password.

For share links:

- the raw token is generated once and returned only in the creation response
- the share URL places the raw token in the URL fragment as `#token=...`
- SQLite stores only a SHA-256 token hash plus a short token prefix
- expired and revoked links stop creating or validating share sessions

After a visitor unlocks a share, Foldergram sets a separate signed `HttpOnly`
cookie named `foldergram_share_session`. That cookie is not an admin or viewer
session. The server re-checks the underlying link or folder-password version
before granting folder access, so revoking a link, expiring a link, changing a
folder password, or removing a folder password invalidates older share grants.

Shared media does not use raw `/thumbnails/...` or `/previews/...` URLs in API
payloads. Shared folder payloads point to `/api/share/images/:id/thumbnail` and
`/api/share/images/:id/preview`, and those routes check that the request has a
grant for the image's folder before serving or lazily generating the derivative.

## Mutation protection

All mutating API routes pass through `requireTrustedMutationRequest`.

That middleware does two things:

1. Requires `x-foldergram-intent: 1`
2. Validates `Origin` or `Referer` against the allowed app origins when those headers are present

Allowed hostnames are:

- `localhost`
- `127.0.0.1`
- `::1`

Allowed ports are:

- `DEV_SERVER_PORT` and the reserved `DEV_CLIENT_PORT` through `DEV_CLIENT_PORT + 3` range in development or test
- `SERVER_PORT` in production, with loopback origins or the exact host that served the app accepted for browser mutations
- explicit extra origins can be allowed through `CSRF_TRUSTED_ORIGINS`

## What this protects against

With password protection enabled, this design helps reduce opportunistic
browsing of the library from other machines on the same network.

Separately, the mutation checks help reduce accidental or cross-site
browser-triggered mutations from untrusted origins.

It is especially relevant for:

- feed and folder reads when password protection is enabled
- generated thumbnails and previews when password protection is enabled and public mode is off
- delete actions
- like toggles
- manual rescans
- rebuild operations
- Settings-only auth changes

## Path confinement

Foldergram does not serve arbitrary filesystem paths from the client.

### Original-file serving

`GET /api/originals/:id`:

- looks up the physical media asset by its numeric `images.id`
- resolves the stored absolute path
- confirms that path is still within `GALLERY_ROOT`
- confirms the file still exists

### Scan error reports

Per-run full scan error reports are written under `<DATA_ROOT>/scan-errors/`
when skip mode records supported-media failures.

- report paths are surfaced through admin-only scan details
- viewer-safe scan responses force `error_text` to `null`
- the report directory is kept separate from `/thumbnails` and `/previews`, so those files are not exposed through derivative static serving

### Delete actions

Delete flows resolve target files and directories inside configured roots before
removing them. If a stored path falls outside the expected root, the operation
throws instead of deleting blindly. Permanent deletion of individual posts also rejects symbolic-link
path components, verifies file and parent-directory identities around each
filesystem mutation, and serializes its own scans, rebuilds, lazy derivative
generation, recovery, and deletion work.

This confinement guarantee covers Foldergram's own concurrent operations and
filesystem state present when an operation is validated. It is not a security
boundary against another process or account that can write to those same roots
and deliberately swap a checked directory at the exact moment of a rename or
unlink. Preventing that race requires platform-specific directory-handle-relative
filesystem operations that Foldergram does not currently use. Keep these storage
roots private to the account running Foldergram and pause other filesystem writers
during permanent deletion or recovery.

## Storage availability behavior

On startup, Foldergram checks:

- gallery directory
- thumbnails directory
- previews directory
- database directory

If the database directory is unavailable, it falls back to an in-memory
database. If the gallery or derivative directories are unavailable, the library
is marked unavailable and the UI receives explicit storage-state information.

This is a resilience measure, not a security feature.

## Rate limiting

Foldergram includes small in-memory rate limiters for:

- authentication attempts
- folder share token and password unlock attempts
- admin mutation routes such as rescan and rebuild operations

These limiters are process-local and intentionally simple. They are useful for
basic abuse reduction, not for hardened distributed deployments.

## Important limitations

Foldergram does **not** currently provide:

- multi-user authentication
- per-user authorization
- TLS termination
- audit logging
- hardened remote deployment defaults
- external identity provider integration
- per-user isolation

## Practical advice

Use Foldergram like a local app:

- use strong, different admin and viewer passwords if you expose it on a homelab or LAN
- remember that public viewer mode exposes the library to anyone who can reach the app
- keep it on loopback unless you know exactly how you are proxying and protecting it
- terminate HTTPS upstream if the app is reachable off-box
- remember that on plain HTTP, both the password and session cookie are visible to anyone who can sniff that local network traffic
- do not assume the password layer and mutation checks are a full internet-facing security boundary
- treat delete actions as destructive and permanent

## A precise caveat about headers

If a mutating request omits both `Origin` and `Referer`, the middleware still
accepts it as long as `x-foldergram-intent: 1` is present. That is acceptable
for the current local-only model, but it is one reason these checks should not
be described as a full remote-hardening story.

## What Foldergram does not try to be

Foldergram is not attempting to be:

- a cloud photo product
- a multi-user NAS portal
- a public media server with account management
- a zero-trust network service

The implementation is much closer to a private local gallery with a browser UI.

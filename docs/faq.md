---
title: FAQ
description: Short answers to common questions about Foldergram's actual scope and behavior.
---

# FAQ

## Is Foldergram a cloud product?

No. The current repository is designed for local-only, self-hosted use.

## Does it upload or sync my media anywhere?

No. Originals stay in the configured gallery root.

## Does it scan files directly during API requests?

No. Request handlers read from SQLite and derivative directories. Scanning is a
separate service.

## Are files in the gallery root indexed?

No. Foldergram ignores files placed directly in `GALLERY_ROOT`.

## Do nested folders merge into their parent album?

No. Nested folders become separate albums when they directly contain supported
media.

## How does the app select a folder's avatar or cover image?

By default, Foldergram automatically selects a `cover.jpg` (or `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`) file within the folder if one exists.
If no explicit cover file is found, it falls back to the most recent (newest) supported media file in that folder.
Admins can also use the "Set as Cover" action from the detail view of any image to set it as the cover without renaming files.
Any explicit `cover.*` files are hidden from the normal folder grid so they don't appear as duplicate posts. Images manually set as the cover via the UI remain visible in the folder grid.

## How do reserved stories folders work?

In the default mode, `AppFolder/stories` is treated as a story source for that
folder:

- direct media inside `stories/` becomes the avatar story set
- each direct child folder becomes one highlight capsule
- nested folders stay inside that same highlight capsule
- story media is hidden from normal folder, feed, and reels surfaces while this mode is active

If you already rely on folders literally named `stories` as normal app folders,
open `Settings -> General Settings`, enable `Treat stories folders as normal
app folders`, then rescan from `Settings -> Scan & Library`.

## Can I exclude source folders from scanning?

Yes.

Foldergram supports two sources of exclusion rules:

- `GALLERY_EXCLUDED_FOLDERS` in `.env` or Docker Compose
- custom rules in `Settings -> General Settings`

Rules without a slash match folder names anywhere in the gallery tree, such as
`@eaDir` or `thumbnails`. Rules with a slash match one exact relative path
under `GALLERY_ROOT`, such as `Archive/cache`.

Changing env-backed rules requires a restart. Changing custom rules in
`General Settings` requires saving the change and then running a scan from
`Scan & Library`.

## Are likes shared with other users?

Admin and viewer sessions share SQLite likes for the current library.

Anonymous public sessions do not write to SQLite likes. They use browser-local
favorites only.

## Are saved posts and collections shared with other users?

Admin and viewer sessions use shared SQLite collections for the current
library.

Anonymous public sessions use browser-local saved posts and collections stored
in `localStorage`.

## Can Foldergram group photos by location?

Yes, when photos already contain GPS EXIF metadata.

Prepare the offline place dataset from `Settings -> Places`, then rebuild place
assignments. Foldergram will expose a Places directory plus place detail pages
for matched photos.

## Can I move `GALLERY_ROOT` without rebuilding everything?

Sometimes.

If the new root still contains the same indexed library at the same relative
paths with matching size, mtime, and extension, Foldergram validates the move
at startup, refreshes stored source paths, and keeps the existing index.

If that validation fails, Foldergram requires `Rebuild Library Index` before
scans continue.

## Does Foldergram have authentication?

It has optional role-based password protection for the app instance.

The current implementation supports:

- an `admin` password with full access
- an optional `viewer` password with browse-only access and shared likes
- an optional `public` browse mode with anonymous local favorites and admin unlock

It still does **not** have per-user accounts or per-user data isolation.

## Can I share only one folder?

Yes. Admins can open a folder page and use the Share button next to `Edit App
Folder`.

Folder sharing supports expiring links, unlimited revocable links, and reusable
per-folder passwords. Shared visitors open `/share/:slug` and can browse only
that folder.

## Do folder shares unlock the whole library?

No. A folder share is not an admin session, viewer session, or public-library
mode. It does not grant Home, feed search, Reels, Places, Likes, Collections,
Trash, Settings, scans, rebuild actions, caption editing, cover editing, delete
actions, or original-file downloads.

## Why does the API call posts "images" in some fields?

That naming is historical. The current app indexes both images and videos, and
several payload fields still use `image` terminology while carrying mixed media.

## Can Foldergram play videos directly from the original file?

Yes, sometimes. Compatible MP4 originals can be exposed as an optional `HD`
source in the detail player while the generated preview remains the default
playback source.

## Why are thumbnails or previews being created while I browse?

That is expected when `DERIVATIVE_MODE=lazy`.

Foldergram still indexes metadata during scans, but it waits to generate
missing thumbnails and previews until `/thumbnails/...` or `/previews/...` is
requested. Once generated, those files are cached on disk for later requests.

## Why would I use `Regenerate Thumbnails` instead of `Rebuild Library Index`?

Use `Regenerate Thumbnails` when the index is still correct and you only want to
regenerate feed/profile thumbnails and video poster images. Use `Rebuild
Library Index` when the gallery root changed or the index itself needs to be
reset.

## Is the local-origin mutation check the same as authentication?

No. It is a separate trust check for browser-triggered mutations.

Foldergram's optional admin/viewer/public access control is the auth layer; the
local-origin mutation check is an additional safeguard around mutating routes.

## Does the app support remote multi-user access?

Not as a documented or hardened product target in the current repository.

The intended scope is still a single-user or shared-household local deployment,
not a full multi-user media portal.

## Can anyone browse the app anonymously?

Yes, if an admin enables `viewer_access_mode=public` from Settings.

In that mode, visitors can browse immediately and keep favorites only in the
current browser, alongside browser-local saved collections. Admin-only controls
still require unlocking with the admin password.

## How do I create a post with several photos or videos?

Put 2–20 supported files directly in `AppFolder/carousels/Post name/`, prefix their filenames to control order, and scan. The first item is the post cover, the child-folder name is the default caption, and the carousel counts as one post. Videos inside it play in the carousel rather than appearing in Reels. See [Carousel Posts](/carousel-posts).

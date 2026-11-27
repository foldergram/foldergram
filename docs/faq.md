---
title: FAQ
description: Answers about organizing media, scanning, playback, sharing, and access.
---

# FAQ

## Is Foldergram a cloud product?

No. Foldergram is self-hosted and local-first. It can optionally connect to your self-hosted Immich server using a restricted read-only API key; see [Immich integration](./immich.md).

## Does it upload or sync my media anywhere?

Foldergram does not upload your media. For local sources, originals stay in the configured gallery root. With the optional [Immich integration](./immich.md), originals remain on your Immich server. Foldergram synchronizes selected remote metadata into SQLite and fetches thumbnails, previews and video playback files on demand through the Immich API. Original downloads are optional and disabled by default.

## Do I need to scan the library every time I open Foldergram?

No. Foldergram saves the library index and uses it when you browse or restart
the app. After adding, moving, or removing local files, run **Scan for changes**
from **Settings → Scan & Library**. A fresh installation scans automatically.
Immich connections have their own sync controls in **Settings → Sources**.

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

Admins and viewers share the library's likes, which are saved on the server.

Anonymous public sessions do not write to SQLite likes. They use browser-local
favorites only.

## Are saved posts and collections shared with other users?

Admins and viewers share the library's saved posts and collections.

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

You can configure:

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
actions, or the library's original-file download route.

## Why does the API call posts "images" in some fields?

That naming is historical. The current app indexes both images and videos, and
several payload fields still use `image` terminology while carrying mixed media.

## Can Foldergram play videos directly from the original file?

Yes. New local videos use streaming by default. Foldergram plays the original
when the browser and connection can handle it. If the video needs conversion,
Foldergram prepares short sections as you watch. Visitors to a shared folder
can also stream the videos they have permission to watch.

## Will upgrading remove my video previews?

No. Upgrading keeps your existing video previews. Videos already in your
library keep their current playback. To see how much space you could free,
open **Settings → Scan & Library** and assess the previews before confirming
cleanup. [See the cleanup steps](./media-processing.md#switch-existing-local-videos-to-streaming).

## Can I import iPhone HEIC photos?

Turn on **Import HEIC/HEIF photos** in **Settings → Scan & Library**, then run
a scan to import [supported still photos](./media-processing.md#experimental-local-heic-and-heif)
from local galleries. Foldergram shows the WebP version and keeps the original
available for authorized download.
Some HDR, 10-bit, and other HEIF variants are outside this preview. Immich
continues to handle the remote originals and derivatives for its own assets.

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

Foldergram provides shared admin and viewer passwords and folder-specific
shares. It does not provide individual user accounts or separate libraries
and permissions for each person. Read [Security](./security.md) before making
an instance accessible outside your household or trusted network.

## Can anyone browse the app anonymously?

Yes, if an admin enables `viewer_access_mode=public` from Settings.

In that mode, visitors can browse immediately and keep favorites only in the
current browser, alongside browser-local saved collections. Admin-only controls
still require unlocking with the admin password.

## Where can I get help or share feedback?

Join the [Foldergram Discord server](https://discord.gg/XPMu6b2NjB) for community help and general questions. Use [GitHub Discussions](https://github.com/foldergram/foldergram/discussions) for longer discussions and [GitHub Issues](https://github.com/foldergram/foldergram/issues) for bug reports.

## How can I support Foldergram?

You can support ongoing development [on Patreon](https://www.patreon.com/sajjadalis). GitHub stars, contributions, bug reports, and sharing Foldergram are also appreciated.

## How do I create a post with several photos or videos?

Put 2–20 supported files directly in `AppFolder/carousels/Post name/`, prefix their filenames to control order, and scan. The first item is the post cover, the child-folder name is the default caption, and the carousel counts as one post. Videos inside it play in the carousel rather than appearing in Reels. See [Carousel Posts](/carousel-posts).

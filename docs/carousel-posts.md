---
title: Posts with Multiple Photos or Videos
description: Create, order, scan, view, and manage carousel posts in Foldergram.
---

# Posts with Multiple Photos or Videos

A carousel is one swipeable post containing 2–20 supported images, animated images, videos, or a mixture of them. It has one caption and one set of like, save, collection, trash, delete, and sharing actions.

## Folder structure

Create a reserved `carousels` folder directly inside an App Folder. Each immediate child is one post, and its media must be directly inside that child.

One carousel beside ordinary posts:

```text
gallery/
  AnimalPlanet/
    cover.jpg
    ordinary-post.jpg
    carousels/
      Lions/
        01-cover.jpg
        02-clip.mp4
        03-pride.jpg
```

Multiple and mixed-media carousels:

```text
gallery/
  Trips/
    carousels/
      Coast/
        01-arrival.jpg
        02-waves.mp4
      City Night/
        sign.gif
        street.jpg
        train.webm
```

An App Folder may contain only carousel posts; no placeholder file is required directly inside it. `carousels` and its post children do not appear as separate App Folders in reserved mode.

## Filename ordering

Items use a case-insensitive natural filename sort, so `2-photo.jpg` sorts before `10-photo.jpg`. Numeric prefixes are optional; use zero-padded prefixes such as `01-`, `02-`, and `03-` only when you want to make the intended order explicit. The first item becomes the post cover in feeds and grids.

Renaming files can reorder a post after the next scan without replacing its caption, likes, or saved state. If more than 20 supported files exist, Foldergram uses the first 20 after sorting and reports a warning.

## Item ordering

Each child folder under `carousels/` is a separate post with its own ordered
slides. Files from different child folders are never mixed into one sequence.
In the example above, `Coast` and `City Night` are two posts; filename prefixes
control the slide order within each one.

The order of those posts in the app is separate from their slide order:

- **Inside a carousel:** files follow the [filename ordering](#filename-ordering) described above. The first file is the post cover.
- **In an album:** posts follow **Newest First** or **Oldest First**, set in **Settings → General Settings**, using their saved post dates.
- **In Home:** the selected **Recent**, **Rediscover**, or **Random** feed mode controls how posts are presented.

Prefixing carousel folder names with `01-` or `02-` does not set their order in
the album or feed. Use prefixes on the files inside a carousel to arrange its
slides, then run **Scan for changes** to apply the new order.

## Renaming and moving carousel posts

You can rename a carousel child folder and add, remove, or replace slides before running a full scan. Foldergram preserves the post ID, caption, likes, saved state, collection membership, and sort date when surviving indexed slides identify one existing post, remain together in one destination, and its old directory is gone. Safe slide matching requires unchanged file size and modification time. If every slide is replaced or no slide can be matched safely, post identity may not be preserved.

If surviving slides from one indexed post are split between carousel directories, the scan stops with an ambiguity error and preserves the existing post memberships. Keep those slides together in one carousel directory and run **Scan for changes** again. Permission and I/O failures also stop the scan rather than treating an inaccessible carousel directory as missing; restore access and retry.

Use a directory name that has not been indexed when renaming a carousel. Foldergram does not merge two indexed post histories. When a destination's media or slide membership changes and file size and modification time match slides from another indexed post whose old files are missing, the scan reports a conflict before replacing destination image records, including when filenames overlap. If a conflict is reported, move the renamed carousel to a directory name that has not been indexed, then scan again; post identity can be preserved only when surviving slides can be matched safely to one existing post.

A replacement that has exactly the same paths, sizes, and modification times as the indexed destination cannot be distinguished from an unchanged destination. Detection is also limited when all incoming files have been modified and no longer match the source index.

## Covers and avatars

The carousel cover and App Folder cover are separate:

- A carousel always uses its first item. A first-position video uses its generated poster.
- A manually selected App Folder cover has first priority.
- A direct `cover.*` file inside the App Folder is next.
- Otherwise, the representative item from the newest visible post is used.

Use **Set as folder cover** in the post viewer to select the currently active carousel item.

## Captions and actions

A carousel has one editable caption. Without a custom caption, the display-safe carousel child-folder name is shown, such as `Lions`, even when anonymous-public responses redact the underlying source path. Likes, saves, collection membership, trash, restore, and deletion apply to the whole post, never to one item.

In the viewer, Download original, Open original, dimensions, file size, format, EXIF details, and Set as folder cover follow the active item. Deleting a carousel permanently removes all included originals and generated derivatives.

Carousel photos and videos fit within the same viewer layout as single posts. Wide and tall slides keep their proportions, with black space where needed, and switching slides does not resize the viewer. Feed cards use the first slide's aspect ratio.

## Search behavior

Search matches filenames, captions, and folder paths across all items in a
carousel. The post appears once even when several items match, and its first
item remains the cover shown in results.

## Reels and mixed videos

Videos play inside the carousel with the same play, mute, and seek controls as
other videos. In the post viewer, the active video slide starts automatically
when the browser allows it. If the browser blocks autoplay with sound, press
Play. The video uses your saved sound setting.

Carousel videos follow the same playback rules as the rest of the library.
When the player offers **HD**, you can switch sources and keep your place.
See [video playback](./features.md#video-playback).

You can use the video controls without changing slides. Switching to another
item pauses the previous video.

Videos inside multi-item carousels do not appear in Reels or contribute to Reels counts. A child folder with exactly one video becomes a normal single-video post, so that fallback post may appear in Reels.

## Edge cases

| Source state | Result |
| --- | --- |
| 2–20 supported direct items | One carousel post. |
| Exactly one supported item | One normal single-item post plus a warning. |
| More than 20 supported items | First 20 are used; skipped items produce a warning and no derivatives. |
| Empty or unsupported-only child | Ignored without creating a post. |
| Hidden file or hidden child | Ignored. |
| Unsupported file beside supported media | Unsupported file is ignored. |
| Supported media directly inside `carousels` | Ignored with a warning; put it in a child folder. |
| Valid child posts plus invalid root media | Valid posts are indexed and root media is warned about. |
| Supported media in a deeper nested folder | Nested media is ignored with a warning. |
| `cover.jpg` inside a carousel child | Treated as an ordinary carousel item. |
| Two-item post loses one item | Same post becomes a single post and keeps its metadata. |
| One-item post gains another item | Same post becomes a carousel and keeps its metadata. |
| Child loses all supported items | Post is soft-deleted and can reactivate later. |
| Reserved folder has only invalid root media | No post or carousel-only App Folder is created. |

## Settings and migration

Reserved carousel mode is the default. In **Settings → General Settings**, turn on **Treat carousels folders as normal app folders** only when directories named `carousels` should use the legacy folder rules.

When there is no indexed `carousels` path conflict and no mode decision has been saved yet, General Settings shows a **Carousel Posts** announcement with an expandable directory example. Dismissing this informational card hides it permanently for the current browser and Foldergram origin. Clearing browser site data, using another browser profile, or opening Foldergram from another origin can show it again while the server-side mode decision remains pending.

When an existing index contains a `carousels` path segment, Settings presents a migration choice:

- **Use Carousel Posts** enables the reserved structure.
- **Keep Normal Folders** preserves legacy folder discovery.

Saving either choice stores the selected folder mode and resolves the migration decision. Settings keeps an update reminder visible until a successful full scan applies that mode to the index. Run **Scan for changes** from **Settings → Scan & Library** to update folders and posts. If the gallery location requires a new index, use **Rebuild Library Index** instead. The same follow-up applies whenever you change **Treat carousels folders as normal app folders**.

## Scanning and media processing

Scanning writes posts, ordered item membership, and asset metadata to SQLite. Pages read that index and do not scan the filesystem during requests. Each included item uses the normal thumbnail, preview, video-poster, and lazy-derivative behavior. No derivative work is scheduled for items skipped beyond the 20-item limit.

Structural problems complete the scan with warnings instead of reporting a processing failure. Review them in **Settings → Scan & Library**.

## Troubleshooting

- **App Folder is missing:** ensure `carousels` has an immediate child containing at least one supported direct media file, then scan.
- **Carousels appear as ordinary folders:** turn off **Treat carousels folders as normal app folders**, save, then run **Scan for changes**.
- **Direct media is ignored:** move it from `AppFolder/carousels` into `AppFolder/carousels/Post name`.
- **Order is unexpected:** use filename prefixes and rescan; dates and discovery order do not control item order.
- **Only 20 items appear:** this is the per-post limit; split the remaining files into another child folder.
- **Nested items are missing:** move them directly into the carousel child; nested discovery is intentionally disabled.
- **An emptied carousel disappears:** removing every supported item soft-deletes that post on the next scan; restoring items reactivates the same indexed post when its media identities can be reconciled.
- **A video is absent from Reels:** videos in a multi-item carousel are intentionally excluded.
- **Caption fallback is unexpected:** edit the shared caption or rename the carousel child and rescan.
- **A scan failed with `UNIQUE constraint failed: post_items.image_id` after a rename:** update Foldergram and run **Scan for changes** again. Recovery without rebuilding requires surviving slides from one indexed post to remain together in one destination, with no competing indexed post at that path. If the scan reports split destinations or an existing-post conflict, follow [Renaming and moving carousel posts](#renaming-and-moving-carousel-posts) before retrying.
- **Cover is unexpected:** position 1 controls the post cover; manual or direct `cover.*` rules control the App Folder avatar.
- **Folder mode has not taken effect:** follow the pending update message in **Settings → Scan & Library**. Run **Scan for changes**, or use **Rebuild Library Index** when Settings reports that a rebuild is required.

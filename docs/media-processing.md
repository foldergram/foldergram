---
title: Media Processing
description: Supported formats, derivative generation rules, and video playback strategy in Foldergram.
---

# Media Processing

Foldergram creates thumbnails and, when needed, preview copies for browsing.
These generated files are called derivatives. They can be prepared during a
scan or on first viewing, then cached on disk. This page explains which formats
are supported and how processing affects playback, storage, and scan time.

## Supported formats

### Images

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.avif`

### Videos

- `.mp4`
- `.mov`
- `.m4v`
- `.webm`
- `.mkv`

## Output sizes

Image sizing values come from `server/src/utils/image-utils.ts`. The video
limits below apply to the older preview policy and come from
`server/src/utils/video-playback-policy.ts`.

| Constant | Value | Used for |
| --- | --- | --- |
| `THUMBNAIL_SIZE` | `640` | Feed cards, folder grids, avatars, and video posters |
| `PREVIEW_MAX_WIDTH` | `1500` | Detail-view image previews and animated AVIF preview width |
| `DIRECT_VIDEO_PLAYBACK_MAX_BYTES` | `24 * 1024 * 1024` | Largest source file that may play directly |
| `DIRECT_VIDEO_PLAYBACK_MAX_DISPLAY_WIDTH` | `1500` | Widest orientation-correct display width that may play directly |

## Derivative timing

`DERIVATIVE_MODE` controls when missing derivatives are created:

| Mode | Behavior |
| --- | --- |
| `eager` | Scans create thumbnails, video posters, and any saved previews the item needs. |
| `lazy` | Scans index metadata only. Missing thumbnails and required previews are generated when `/thumbnails/...` or `/previews/...` is first requested. |

Lazy mode saves generated files on disk so Foldergram can reuse them.
Both modes follow the same playback rules. Videos set to streaming need a
poster and prepare any required conversions when you play them.

## Scan-time media failures

`SCAN_MEDIA_ERROR_MODE` controls what happens when supported media reaches scan
processing but fails during stat, metadata, derivative generation, or
derivative-repair work.

| Mode | Behavior |
| --- | --- |
| `skip` | Report the failure, skip that file, continue scanning, and finish the run as `completed_with_errors`. |
| `fail` | Stop on the first such failure and mark the run as failed. |

In skip mode, Foldergram keeps a short admin-visible sample in SQLite and
writes the full per-run report under `<DATA_ROOT>/scan-errors/`.

This applies to supported image and video files that actually reach scan
processing. Unsupported extensions are still ignored earlier during discovery.

## Derivative mapping

Foldergram stores derivatives by stable asset key, not by source-relative path.
Thumbnails and previews share the same shard layout so a media item keeps the
same derivative location even when its source folder path changes.
The current layout uses a single shard segment based on the first two hex
characters of `asset_key`.

| Source media | Thumbnail output | Preview output |
| --- | --- | --- |
| Image | `.webp` | `.webp` |
| Video | `.webp` | `.mp4` if the video needs a saved preview |

Examples:

| Source | Thumbnail | Preview |
| --- | --- | --- |
| `trips/oslo/IMG_0001.jpg` | `ab/abcd1234....webp` | `ab/abcd1234....webp` |
| `trips/oslo/clip-01.mov` | `ef/ef01abcd....webp` | `ef/ef01abcd....mp4` in preview mode |

Existing libraries are migrated in place on the next full scan after upgrade.
Old mirrored derivative paths keep working until that migration completes. If a
stored derivative path points at a missing file during the upgrade, Foldergram
keeps the last known-good path until the new target is repaired or regenerated.

## Image derivatives

Most images are processed with Sharp. Static AVIF files also stay on the Sharp path so transparency and regular image behavior are preserved.

### Thumbnail

- auto-rotated
- resized to width `640` without enlargement
- encoded as WebP with `quality: 82`

### Preview

- auto-rotated
- resized to width `1500` without enlargement
- encoded as WebP with `quality: 86`

## Experimental local HEIC and HEIF

Enable **Import HEIC/HEIF photos** in **Settings → Scan & Library**, then run
**Scan for changes** to import supported `.heic` and `.heif` files from the
primary gallery and any additional local sources. The preference applies from
the next scan. Turning it off keeps previously indexed photos and their
derivatives available and continues to reconcile changes to their originals.
Immich uses its own metadata and media endpoints.

If Settings shows **Managed by environment**, see the
[HEIC environment override](./configuration.md#local-heic-and-heif-imports).

Some devices and exports save HEIC photos with a JPEG extension, such as
`IMG_1234.HEIC.jpeg`. The scan reads the first bytes of new or changed `.jpg`
and `.jpeg` files and treats a file whose header declares a HEVC still image
(`heic` or `heix` brand) as HEIC. AVIF files and image sequences are not
affected. These photos follow the same import setting, limits, and WebP viewing
as `.heic` files, and keep their original name and bytes. Their original
downloads use the `image/heic` MIME type.

Experimental HEIC support accepts 8-bit SDR HEVC stills, including grid-composed stills
and files with recognized thumbnail or auxiliary items. It renders the primary
image to sRGB WebP. The worker handles container orientation first and uses
EXIF orientation when there is no container rotation or mirror transform.
Supported colors include sRGB-like SDR and the Display P3 cases covered by
the prototype. Sequences, independent image collections, non-HEVC codecs,
unrecognized ICC profiles, 10-bit originals, and HDR rendering are outside
this preview. An SDR primary may be used when its auxiliary gain map is ignored.

A worker inspects the container and reads EXIF from the original during a scan.
Eager processing decodes the full image once for both WebP outputs. Lazy
processing waits for a derivative request before decoding pixels. Normal viewing
uses WebP even with `IMAGE_DETAIL_SOURCE=original`. Authorized original
downloads retain the source file bytes, name, and MIME type.

Decoding takes CPU and temporary memory. Browsing reuses saved WebP outputs.
Replacing a file or rebuilding its derivatives can trigger another decode. See
[configuration](./configuration.md#optional-heic-tuning) for worker limits. A
busy worker queue can return a temporary error. Invalid or unsupported media is
reported in scan diagnostics. Contributors investigating decoder support can
read the [HEIC validation notes](https://github.com/foldergram/foldergram/blob/main/server/test/heic-prototype-validation.md)
for tested samples, performance measurements, and remaining validation work.

## Animated AVIF handling

Animated AVIF image sequences are treated as images in the UI, not videos.

Foldergram uses:

- Sharp first for normal static AVIF image metadata
- `ffprobe` to identify animated AVIF image sequences when Sharp cannot decode them reliably
- `ffmpeg` to generate static WebP thumbnails and animated WebP previews for animated AVIF files

This hybrid path keeps static AVIF on the normal Sharp image pipeline while still supporting animated AVIF sequences that Sharp cannot decode reliably in the current runtime.

Existing libraries with already indexed AVIF files receive a one-time AVIF
metadata repair on the next successful full scan after upgrade, including
**Scan for changes** even when folder contents are unchanged. That pass
refreshes legacy animated flags and AVIF timestamp fallbacks for stored rows,
then stops re-reading unchanged AVIF files on later scans.
If metadata inspection fails, the repair stays pending for a later scan.

## Image detail source

`IMAGE_DETAIL_SOURCE` affects image detail pages only:

| Value | Behavior |
| --- | --- |
| `preview` | `/image/:id` uses the generated preview asset. |
| `original` | `/image/:id` uses `/api/originals/:id` for images. |

This setting does not change feed cards, folder grids, avatars, or any video
playback behavior.

## Video metadata

Foldergram uses `ffprobe` to read local video duration, dimensions, rotation,
and creation time when available. It also records the format, video codec,
audio tracks, and color information so it can choose how to play the video.
Immich supplies its own metadata and playback.

## Video thumbnail generation

Video thumbnails are generated with `ffmpeg`:

- `thumbnail` filter picks a representative frame
- the frame is resized to width `640`
- output is encoded as WebP

## Video preview generation

For videos using the preview policy, Foldergram makes an MP4 preview when the
original needs conversion or an active folder share needs a copy. FFmpeg
generates previews with the following settings:

- H.264 video
- AAC audio when audio is present
- `yuv420p`
- `+faststart`
- landscape-equivalent output up to `1280x720`
- portrait and square output that keeps the short edge at or below `720`
- even-numbered output dimensions for encoder compatibility

Audio selection uses the first audio stream, in source stream order, whose codec
has a decoder in the installed FFmpeg build. Unsupported tracks are skipped;
only the selected track is encoded to AAC. Videos without audio remain silent.
If audio tracks exist but none has an available decoder, generation fails and
reports an error instead of silently dropping all audio. Decoder availability
does not guarantee a damaged track can decode; conversion errors still fail the
preview and remain visible in scan reports.

Video previews are written to unique temporary MP4 files beside the destination.
After successful conversion, Foldergram checks that the output is nonempty and
FFprobe reports an MP4 with H.264/yuv420p video, positive dimensions and duration,
and the expected AAC audio. It then atomically replaces the cached preview.
Failures remove temporary output and preserve an existing preview.

Empty derivative files are treated as missing during generation, migration,
repair scans, and lazy requests. Cache reads check file size without probing
media on every request. Nonempty legacy files are trusted; a nonempty corrupt
or truncated legacy preview requires forced regeneration. The publication probe
checks container and stream metadata, rather than decoding the full output.

## Streaming for new local videos

New local videos stream by default. Foldergram plays the original when the
browser and connection can handle it. Otherwise, FFmpeg prepares short sections
as you watch. Foldergram keeps those sections in a temporary cache so it can
reuse them the next time you play or seek in the same video.

You see the cover while playback starts. If the video can't play, select
**Retry playback** in the player. The first play or a jump to a new part of
the video may take longer and use more CPU when conversion is needed.

Existing local videos keep their current playback after an upgrade. Immich
continues to use its own playback. To use saved MP4 previews for future local
imports, see the [video playback settings](./configuration.md#video-playback).

**Settings → Scan & Library → Video playback** shows the configured mode and
whether indexed videos still need switching. This quick status does not scan
preview files on disk. In streaming mode, use **Check for remaining previews**
to look for leftover files even when every indexed video already uses streaming.
After an operation, its result stays visible in the browser until you dismiss
it. When there is no known work left, only the status row remains.

### Switch existing local videos to streaming

The cleanup card appears in `streaming` mode when there are local videos to
switch or saved previews to assess.

1. Open **Settings → Scan & Library → Switch to streaming and remove video previews**.
2. Pick a local source or **All local sources**, then select **Assess previews**.
3. Review the estimated space savings, the number of previews to remove, and the number of videos that will switch to streaming.
4. Select **Switch to streaming and remove video previews**, then confirm with **Remove previews**.

Foldergram tests parts of each original before removing its preview. Videos
whose originals are missing, have changed, or fail the check keep their
existing previews. Your originals, photos, thumbnails, library organization, and Immich
data stay in place. Future imports still follow your existing video playback
setting.

The cleanup result shows how many previews were removed and how much space was
freed. You can dismiss it when you're done. Use **Cancel operation** to stop
between videos, or **Resume or retry** if the app reports unfinished work.

### Switch existing local videos to saved previews

When `VIDEO_DELIVERY_MODE=previews`, **Settings → Scan & Library** shows how
many existing local videos still use streaming. Open **Switch existing videos
to saved previews**, choose a local source or **All local sources**, and select
**Check videos**. Review the estimate, then select **Generate previews and
switch**.

Eligible originals can play directly. For other videos and videos that need a
copy for an active folder share, Foldergram generates a full MP4 preview before
switching playback. This also works in lazy mode. A video keeps streaming if
generation fails. You can cancel between videos and resume or retry unfinished
work. The job leaves your original files and library index in place.

If you change the setting while a job is unfinished, **Scan & Library** still
shows its progress and recovery controls. New jobs follow the configured mode.

### Playback URLs from older clients

An old preview URL can serve a compatible MP4 original through the same
access checks. If Foldergram can't serve it, the URL returns HTTP 410 and asks
the user to reload. Update the client and server together.

## Direct-original video playback for legacy and preview policies

Foldergram can use the original video as the ordinary playback source when all
of these are true:

- the file extension is `.mp4`
- the container is compatible with MP4
- the video codec is H.264
- the pixel format is `yuv420p`
- the audio codec is AAC, or there is no audio track
- the source size is known, positive, and at most `24 MiB` inclusive
- the orientation-correct display width is known, positive, and at most `1500` pixels inclusive

Unknown or incomplete compatibility metadata conservatively keeps the generated
preview until a later indexing or backfill pass can establish eligibility. The
width budget uses display width, so rotated and portrait videos follow the same
orientation-correct dimensions shown by the app. It is not a bitrate or
pixel-count limit.

When a video qualifies:

- Foldergram still generates the thumbnail/poster.
- Normal playback uses the indexed original-media endpoint. For example,
  `previewUrl` resolves to `/api/originals/:id`.
- `playbackStrategy` continues to report original-playback compatibility.
- `videoPlaybackSource` reports the selected ordinary source as `original`.
- Feed cards, folder pages, Reels, stories, likes, collections, and Carousel
  members use that same selected source.
- The detail player does not show an HD switch when playback is already the
  original. Larger compatible videos that use a generated preview keep the
  existing preview/HD switch behavior.

When a video is above either budget, or compatibility metadata does not qualify:

- A generated preview remains required for ordinary playback.
- `videoPlaybackSource` is `preview`.
- The original may still be offered through the detail player's HD switch when
  `playbackStrategy` is `original`.

### Folder shares

Folder-share visitors do not receive ordinary `/api/originals/:id` access.
Shared payloads continue to use `/api/share/images/:id/preview`. A qualifying
video may still need a generated preview when a folder has an active,
unexpired link share or a configured share password. Eager processing of new or
repaired media can create or retain those shared previews. Lazy shared delivery
can create one on authorized first access.

### Upgrade, old URLs, and reclamation

Existing indexed metadata is enough to select originals. No library rebuild or
all-library FFprobe pass is required.

Previously issued normal `/previews/...mp4` URLs keep working in both eager and
lazy modes. For a currently eligible asset, the preview URL resolves to the same
original-media serving path. The response does not use the immutable derivative
cache policy because it is serving a mutable original. It uses
revalidation-friendly caching (`private, no-cache` with `Vary: Cookie` when
password protection is enabled, or `public, no-cache` otherwise) while preserving
`ETag`, `Last-Modified`, and byte-range behavior.

**Scan and repair derivatives** keeps existing previews for videos that
qualify for direct playback and can generate a preview needed by an active
share. Use [preview cleanup](#switch-existing-local-videos-to-streaming) to
switch these videos to streaming and free the space.

When a source video changes, the scanner invalidates the previous generated
preview so that later playback and sharing use the current source. An absent
video preview is treated as expected rather than as corruption, so it does not
trigger repeated transcoding or prevent migration completion.

## GIF handling

GIF files are accepted as supported images, but derivatives are generated with
`animated: false`. In practice that means Foldergram treats GIF derivatives as
static image outputs, not animated preview pipelines.

## Timestamp sources

Foldergram resolves `taken_at` from the best available source:

- EXIF or embedded media metadata when available
- file modification time or first-seen timing when richer metadata is absent

Those timestamps influence:

- Recent feed ordering
- Moments eligibility
- Highlights fallback behavior

## Thumbnail-only rebuild

The thumbnail rebuild action:

- removes the thumbnail cache directory
- recreates it
- rebuilds thumbnails and video poster images for currently indexed media

It does not regenerate previews. In lazy mode it acts as a thumbnail and poster
prewarm only; preview generation still happens on demand.

## Why derivatives are sharded by asset key

Sharding keeps derivative directories small and decouples cache storage from the
gallery tree. That lets Foldergram:

- preserve the same thumbnail and preview paths when a media item is moved
- migrate existing derivatives in place instead of regenerating everything
- garbage-collect stale derivatives by indexed asset reference instead of by mirrored folder tree

## Carousel items

Every included carousel item uses the normal thumbnail, preview, poster, and lazy-generation pipeline. Position 1 supplies the feed/grid cover; later items are fitted inside the shared stage without modifying originals. Only the first 20 naturally sorted supported files are indexed, and skipped extras do not enter derivative queues.

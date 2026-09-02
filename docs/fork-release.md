# maiga512/foldergram

This repository is a community-maintained Fork of [foldergram/foldergram](https://github.com/foldergram/foldergram).
It is not an official release of the upstream project and does not imply endorsement by the original authors.

## What This Fork Changes

- Reuses one shared player instance when moving from feed cards to immersive playback.
- Adds immersive image/video playback across feed, search, folders, likes, and archive views.
- Coordinates relative horizontal seeking, vertical dismiss, pinch zoom with X/Y panning, hold-to-speed playback, and orientation changes.
- Preserves playback time and playing state when handing a media item from a small window to the immersive player.
- Keeps the mute preference consistent across feed, reels, immersive playback, and other media surfaces.
- Uses direct original-media playback where the browser can decode the source, avoiding NAS-side preview transcoding for that path.
- Adds direct post sharing with copied links, plus collection/archive and trash-flow improvements.
- Improves incremental filesystem discovery, scan concurrency, first-screen loading, and PWA route/scroll continuity.
- Adds regression tests for player coordination, playback handover, sharing, deletion, and incremental scanning.

## Compatibility Notes

Direct playback depends on the browser and device supporting the source codec and container. Unsupported media may still require the application's existing derivative or stream path. This Fork does not publish any private media, database, environment file, NAS address, password, SSH key, or deployment secret.

## License and Attribution

This Fork remains licensed under `AGPL-3.0-only`. Copyright and license notices from the upstream project are retained. If this modified version is run as a network service, operators should provide the corresponding source code and the other notices required by the AGPL.

The upstream project is maintained at [github.com/foldergram/foldergram](https://github.com/foldergram/foldergram). Please report Fork-specific issues in this repository; upstream contribution proposals should be small and focused and should follow the upstream contribution policy.

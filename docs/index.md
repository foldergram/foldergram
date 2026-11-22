---
layout: home
title: Foldergram
titleTemplate: false
hero:
  name: "Foldergram"
  text: "Local-first photo and video gallery"
  tagline: Point it at your folders, browse everything through a fast feed-style interface. No cloud, no accounts — just your files and SQLite.
  image:
    src: /logo.svg
    alt: Foldergram Logo
  actions:
    - theme: brand
      text: Quick Start
      link: /quick-start
    - theme: alt
      text: How It Works
      link: /how-it-works
    - theme: alt
      text: Live Demo
      link: https://foldergram.intentdeep.com/
features:
  - icon:
      src: /icons/local-first.svg
      width: "36"
      height: "36"
    title: Local-first
    details: Originals stay in your gallery folder, untouched. Indexed metadata lives in SQLite on disk. Local folders need no external API or account. The optional read-only Immich integration reuses media from your self-hosted server.
  - icon:
      src: /icons/fast-feed.svg
      width: "36"
      height: "36"
    title: Fast feed-style browsing
    details: Runtime reads come from SQLite and pre-generated derivatives instead of live filesystem walks. Pagination, lazy loading, and three feed modes keep browsing snappy.
  - icon:
      src: /icons/media.svg
      width: "36"
      height: "36"
    title: Photos and videos
    details: Indexes JPEG, PNG, WebP, GIF, AVIF, MP4, MOV, M4V, WebM, and MKV. Thumbnails and previews are generated automatically during scans or on demand in lazy mode. Videos get a full reels view with scroll-snap playback.
  - icon:
      src: /icons/access-control.svg
      width: "36"
      height: "36"
    title: Optional access control
    details: Runs open by default. Enable an admin password, a viewer password, or anonymous public mode from Settings. Non-admin sessions can browse but cannot scan, delete, or rebuild.
---

## Foldergram at a Glance

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: 1rem; margin: 2rem 0;">

<div class="cs-feature">
<div class="cs-feature-icon">
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
</div>
<h3>What ships today</h3>
<p>Home (Recent, Rediscover, Random feed modes), Reels, Explore, Library, Places, Collections, Trash, Folder pages, post detail and modal, Likes, saved posts, Moments or Highlights, folder stories, Settings, and local scan and rebuild tooling.</p>
</div>

<div class="cs-feature">
<div class="cs-feature-icon">
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
</div>
<h3>How indexing works</h3>
<p>Foldergram walks <code>GALLERY_ROOT</code> recursively, skipping hidden paths. Files directly at the gallery root are ignored, while ordinary nested folders that directly contain supported media become separate albums. In the default reserved modes, <code>stories/</code> descendants provide stories and highlights, and media in <code>carousels/Post name/</code> becomes a post in its owning App Folder instead of making those reserved descendants separate albums; a valid carousel child can also qualify a carousel-only owner as an App Folder.</p>
</div>

<div class="cs-feature">
<div class="cs-feature-icon">
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
</div>
<h3>Formats and storage</h3>
<p>Images: <code>.jpg</code>, <code>.jpeg</code>, <code>.png</code>, <code>.webp</code>, <code>.gif</code>, <code>.avif</code>. Videos: <code>.mp4</code>, <code>.mov</code>, <code>.m4v</code>, <code>.webm</code>, <code>.mkv</code>. Originals are never moved. SQLite stores metadata. Thumbnails and previews are written under <code>thumbnails/</code> and <code>previews/</code>.</p>
</div>

<div class="cs-feature">
<div class="cs-feature-icon">
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
</div>
<h3>Access modes</h3>
<p>No password gate by default. Settings can enable admin-only access, a separate viewer password, or anonymous public mode. Admin sessions can run scans, rebuild indexes, delete posts, and manage access credentials.</p>
</div>

</div>

## How Foldergram Works

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 1rem; margin: 2rem 0;">

<div class="cs-feature">
<div class="cs-feature-step">1</div>
<h3>Discover folders</h3>
<p>Walk the gallery tree, skip hidden paths, and collect every non-hidden folder that directly contains supported media files. In reserved carousel mode, a folder also qualifies when its <code>carousels/</code> directory has an immediate child containing supported media directly.</p>
</div>

<div class="cs-feature">
<div class="cs-feature-step">2</div>
<h3>Index posts</h3>
<p>Store normalized paths, media metadata, EXIF timestamps, stable sort order, optional place assignments, and playback strategy in SQLite. Missing files are soft-deleted rather than hard-removed.</p>
</div>

<div class="cs-feature">
<div class="cs-feature-step">3</div>
<h3>Prepare thumbnails and previews</h3>
<p>Foldergram prepares thumbnails and any needed previews during a scan or on first request. New local videos stream by default.</p>
</div>

<div class="cs-feature">
<div class="cs-feature-step">4</div>
<h3>Serve fast reads</h3>
<p>Feed, folder, reels, explore, likes, and moments pages all read from SQLite and serve derivative URLs — no filesystem walk per request.</p>
</div>

<div class="cs-feature">
<div class="cs-feature-step">5</div>
<h3>Build Moments, Stories, and Places</h3>
<p>Home surfaces date-based Moments when EXIF timestamps are available, or Highlights otherwise. Reserved <code>AppFolder/stories</code> subfolders power avatar stories and highlight rings, and prepared offline place data can group GPS-tagged photos into Places pages.</p>
</div>

<div class="cs-feature">
<div class="cs-feature-step">6</div>
<h3>Maintain locally</h3>
<p>Admins manage Home, Reels, and folder-order defaults, stories and carousel folder modes, excluded folders, and Places preparation from Settings, then run scans or rebuilds locally. All controls stay on disk and on-device.</p>
</div>

</div>

<section class="featured-on" aria-labelledby="featured-on-title">
  <p id="featured-on-title" class="featured-on-title">Featured on</p>
  <div class="featured-on-badges">
    <a href="https://fazier.com/launches/foldergram.github.io" target="_blank" rel="noopener noreferrer">
      <img class="featured-on-badge featured-on-badge-light" src="https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=launched&amp;theme=neutral" width="120" height="36" alt="Fazier launch badge">
      <img class="featured-on-badge featured-on-badge-dark" src="https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=launched&amp;theme=dark" width="120" height="36" alt="Fazier launch badge">
    </a>
    <a href="https://www.producthunt.com/products/foldergram?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-foldergram" target="_blank" rel="noopener noreferrer">
      <img class="featured-on-badge featured-on-badge-light" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1164910&amp;theme=neutral&amp;t=1780741309228" width="250" height="54" alt="Foldergram - Turn your local folders into dynamic, private feeds | Product Hunt">
      <img class="featured-on-badge featured-on-badge-dark" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1164910&amp;theme=dark&amp;t=1780741080943" width="250" height="54" alt="Foldergram - Turn your local folders into dynamic, private feeds | Product Hunt">
    </a>
  </div>
</section>

import { readFileSync } from 'node:fs';

import { defineConfig } from 'vitepress';

const appPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
) as { version: string };

const guideItems = [
  { text: 'Quick Start', link: '/quick-start' },
  { text: 'Installation', link: '/installation' },
  { text: 'Configuration', link: '/configuration' },
  { text: 'Immich Integration', link: '/immich' }
];

const productItems = [
  { text: 'How It Works', link: '/how-it-works' },
  { text: 'Features', link: '/features' },
  { text: 'Carousel Posts', link: '/carousel-posts' },
  { text: 'Media Processing', link: '/media-processing' },
  { text: 'Security', link: '/security' }
];

const referenceItems = [
  { text: 'API', link: '/api' },
  { text: 'Development', link: '/development' },
  { text: 'Troubleshooting', link: '/troubleshooting' },
  { text: 'FAQ', link: '/faq' }
];

export default defineConfig({
  title: 'Foldergram',
  description: 'Documentation for Foldergram, the local-first photo and video gallery.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#6366f1' }],
    ['style', {}, `:root { --foldergram-docs-version: ${JSON.stringify(`v${appPackage.version}`)}; }`]
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Foldergram',
    search: {
      provider: 'local'
    },
    nav: [
      { text: 'Quick Start', link: '/quick-start' },
      { text: 'Installation', link: '/installation' },
      { text: 'Configuration', link: '/configuration' },
      { text: 'How It Works', link: '/how-it-works' },
      { text: 'API', link: '/api' },
      { text: 'Security', link: '/security' },
      { text: 'Demo', link: 'https://foldergram.intentdeep.com/' }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/foldergram/foldergram' }
    ],
    sidebar: [
      {
        text: 'Guide',
        items: guideItems
      },
      {
        text: 'Product',
        items: productItems
      },
      {
        text: 'Reference',
        items: referenceItems
      }
    ],
    outline: {
      level: [2, 3],
      label: 'On this page'
    },
    footer: {
      message: 'Released under the AGPL-3.0 License.',
      copyright: 'Copyright © 2026 Sajjad Ali'
    }
  }
});

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedItem } from '../types/api';
import ReelDeck from './ReelDeck.vue';

vi.mock('vidstack/bundle', () => ({}));

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 1,
    folderSlug: 'clips',
    folderName: 'Clips',
    folderPath: 'clips',
    folderBreadcrumb: null,
    filename: `clip-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    durationMs: 30_000,
    thumbnailUrl: `/api/thumbnails/${id}.webp`,
    previewUrl: `/api/previews/${id}.mp4`,
    sortTimestamp: id,
    takenAt: null
  };
}

describe('ReelDeck', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('warms only the two cards after the active one', () => {
    const items = [1, 2, 3, 4, 5].map(createFeedItem);
    const wrapper = mount(ReelDeck, {
      props: {
        items,
        folders: [],
        activeReelId: 2
      },
      global: {
        stubs: {
          ReelPlayerCard: {
            props: ['item', 'folder', 'active', 'prefetch'],
            template: '<div class="reel-stub" :data-id="item.id" :data-prefetch="prefetch ? \'1\' : \'0\'" />'
          }
        }
      }
    });

    const prefetchByItemId = new Map(
      wrapper.findAll('.reel-stub').map((stub) => [stub.attributes('data-id'), stub.attributes('data-prefetch')])
    );

    // Buffering exactly the next two keeps swipes instant without decoding the whole deck.
    expect(prefetchByItemId.get('2')).toBe('0');
    expect(prefetchByItemId.get('3')).toBe('1');
    expect(prefetchByItemId.get('4')).toBe('1');
    expect(prefetchByItemId.get('5')).toBe('0');
    expect(prefetchByItemId.get('1')).toBe('0');
  });

  it('does not warm anything when the active reel is unknown', () => {
    const wrapper = mount(ReelDeck, {
      props: {
        items: [createFeedItem(9)],
        folders: [],
        activeReelId: null
      },
      global: {
        stubs: {
          ReelPlayerCard: {
            props: ['item', 'folder', 'active', 'prefetch'],
            template: '<div class="reel-stub" :data-prefetch="prefetch ? \'1\' : \'0\'" />'
          }
        }
      }
    });

    expect(wrapper.get('.reel-stub').attributes('data-prefetch')).toBe('0');
  });
});

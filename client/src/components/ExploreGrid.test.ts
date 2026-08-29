import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImmersiveImageStore } from '../stores/immersive-image';
import type { FeedItem } from '../types/api';
import ExploreGrid from './ExploreGrid.vue';

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');

  return {
    ...actual,
    useRoute: () => ({
      fullPath: '/explore?q=animals',
      query: {
        q: 'animals'
      }
    })
  };
});

function createImageItem(id: number): FeedItem {
  return {
    id,
    folderId: 21,
    folderSlug: 'wildlife',
    folderName: 'Wildlife',
    folderPath: 'wildlife',
    folderBreadcrumb: null,
    filename: `photo-${id}.jpg`,
    width: 1200,
    height: 1500,
    mediaType: 'image',
    durationMs: null,
    isAnimated: false,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

describe('ExploreGrid', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('builds named post routes so explore tiles resolve through the canonical viewer path', () => {
    const wrapper = mount(ExploreGrid, {
      props: {
        items: [createImageItem(215)]
      },
      global: {
        stubs: {
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          },
          RouterLink: {
            props: ['custom', 'to'],
            template: `
              <template v-if="custom">
                <span class="router-link-stub" :data-to="typeof to === 'string' ? to : JSON.stringify(to)">
                  <slot href="#" :navigate="() => {}" />
                </span>
              </template>
              <a v-else :data-to="typeof to === 'string' ? to : JSON.stringify(to)"><slot /></a>
            `
          }
        }
      }
    });

    const tileRoute = wrapper.get('a[data-to]');

    expect(tileRoute.attributes('data-to')).toContain('"name":"image"');
    expect(tileRoute.attributes('data-to')).toContain('"id":"215"');
    expect(tileRoute.attributes('data-to')).toContain('"q":"animals"');
  });

  it('opens a tapped tile in the immersive layer instead of navigating away', async () => {
    const imageStore = useImmersiveImageStore();
    const navigate = vi.fn();

    const wrapper = mount(ExploreGrid, {
      props: {
        items: [createImageItem(311)]
      },
      global: {
        stubs: {
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          },
          RouterLink: {
            // Declared as a Boolean so the bare `custom` attribute resolves to true and
            // the grid's own anchor is what ends up in the DOM.
            props: { custom: { type: Boolean, default: false }, to: { type: null, default: null } },
            template: '<span class="router-link-stub"><slot href="#" :navigate="navigate" /></span>',
            setup: () => ({ navigate })
          }
        }
      }
    });

    await wrapper.get('a').trigger('click', { button: 0 });

    // Search results have to reach the same players as the feed, so the delete entry and
    // the playback gestures are the ones the viewer already knows.
    expect(imageStore.isOpen).toBe(true);
    expect(imageStore.target?.id).toBe(311);
    expect(navigate).not.toHaveBeenCalled();
  });
});

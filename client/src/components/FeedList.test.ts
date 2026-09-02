import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import FeedList from './FeedList.vue';

const FeedCardStub = {
  props: ['item', 'isActiveVideo'],
  template: '<div :data-id="item.id" :data-active="isActiveVideo" />'
};

describe('FeedList', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('activates a video once the observer reports the first meaningful visible slice', async () => {
    const wrapper = mount(FeedList, {
      props: {
        context: 'home',
        items: [
          {
            id: 41,
            folderId: 1,
            folderSlug: 'clips',
            folderName: 'Clips',
            folderPath: 'Clips',
            folderBreadcrumb: null,
            filename: 'visible.mp4',
            width: 1080,
            height: 1920,
            mediaType: 'video',
            thumbnailUrl: '/thumb.webp',
            previewUrl: '/video.mp4',
            sortTimestamp: 1,
            takenAt: 1
          }
        ]
      },
      global: {
        stubs: { FeedCard: FeedCardStub }
      }
    });

    await wrapper.findComponent(FeedCardStub).vm.$emit('video-visibility-change', {
      id: 41,
      ratio: 0.2,
      centerOffset: 24
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-id="41"]').attributes('data-active')).toBe('true');
  });
});

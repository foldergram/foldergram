import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../locales';
import { useAppStore } from '../stores/app';
import { useShareStore } from '../stores/share';
import SharedPostView from './SharedPostView.vue';

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');
  return {
    ...actual,
    useRoute: () => ({ name: 'shared-post' })
  };
});

describe('SharedPostView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
  });

  it('uses the app-wide mute preference instead of native video state', async () => {
    const appStore = useAppStore();
    const shareStore = useShareStore();
    appStore.setVideoMuted(false);
    shareStore.image = {
      id: 41,
      folderId: 7,
      folderSlug: 'shared-clips',
      folderName: 'Shared clips',
      folderPath: 'shared-clips',
      folderBreadcrumb: null,
      filename: 'clip.mp4',
      caption: null,
      width: 1080,
      height: 1920,
      mediaType: 'video',
      mimeType: 'video/mp4',
      durationMs: 12_000,
      thumbnailUrl: '/thumbs/41.webp',
      previewUrl: '/previews/41.mp4',
      originalUrl: '/api/originals/41',
      playbackStrategy: 'original',
      sortTimestamp: 1,
      takenAt: null,
      previousImageId: null,
      nextImageId: null,
      postType: 'single',
      mediaItems: null
    } as typeof shareStore.image;
    shareStore.loadImage = vi.fn().mockResolvedValue(undefined);

    const wrapper = mount(SharedPostView, {
      props: { slug: 'shared-clips', id: '41' },
      global: {
        plugins: [i18n],
        stubs: {
          CarouselMediaStage: true,
          ErrorState: true,
          ResilientImage: true,
          RouterLink: { template: '<a><slot /></a>' },
          VideoMediaPlayer: {
            props: ['muted'],
            emits: ['toggle-mute'],
            template:
              '<button data-test="shared-video" :data-muted="String(muted)" @click="$emit(\'toggle-mute\')" />'
          }
        }
      }
    });
    await flushPromises();

    expect(wrapper.find('video').exists()).toBe(false);
    expect(wrapper.get('[data-test="shared-video"]').attributes('data-muted')).toBe('false');

    await wrapper.get('[data-test="shared-video"]').trigger('click');
    expect(appStore.videoMuted).toBe(true);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');
    expect(wrapper.get('[data-test="shared-video"]').attributes('data-muted')).toBe('true');
  });
});

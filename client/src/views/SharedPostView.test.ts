import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../stores/app';
import { useShareStore } from '../stores/share';
import SharedPostView from './SharedPostView.vue';

vi.mock('vue-router', async () => ({
  ...await vi.importActual<typeof import('vue-router')>('vue-router'),
  useRoute: () => ({ name: 'shared-post' })
}));

describe('SharedPostView sound preference', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const shareStore = useShareStore();
    vi.spyOn(shareStore, 'loadImage').mockResolvedValue(undefined);
    shareStore.image = {
      id: 1, folderId: 1, folderSlug: 'clips', folderName: 'Clips',
      filename: 'clip.mp4', caption: null, mediaType: 'video', mimeType: 'video/mp4',
      width: 1080, height: 1920, durationMs: 10_000,
      thumbnailUrl: '/thumbnail.webp', previewUrl: '/preview.mp4', sortTimestamp: 1,
      previousImageId: null, nextImageId: null
    };
  });

  it('follows shared sound changes and saves changes made in the native controls', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(true);
    const wrapper = mount(SharedPostView, {
      props: { slug: 'clips', id: '1' },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } }
    });
    await flushPromises();
    const video = wrapper.get('video').element;
    expect(video.muted).toBe(true);

    appStore.setVideoMuted(false);
    await flushPromises();
    expect(video.muted).toBe(false);

    video.muted = true;
    await wrapper.get('video').trigger('volumechange');
    expect(appStore.videoMuted).toBe(true);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');

    video.muted = false;
    await wrapper.get('video').trigger('volumechange');
    expect(appStore.videoMuted).toBe(false);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('false');

    video.volume = 0;
    await wrapper.get('video').trigger('volumechange');
    expect(appStore.videoMuted).toBe(true);
    appStore.setVideoMuted(false);
    await flushPromises();
    expect(video.muted).toBe(false);
    expect(video.volume).toBeGreaterThan(0);
    wrapper.unmount();
  });
});

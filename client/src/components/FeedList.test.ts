import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import FeedList from './FeedList.vue';
import { useSharedVideoSurfaceStore } from '../stores/shared-video-surface';

const FeedCardStub = {
  props: ['item', 'isActiveVideo'],
  template: '<div :data-id="item.id" :data-active="isActiveVideo" />'
};

function videoItem(id: number) {
  return {
    id,
    folderId: 1,
    folderSlug: 'clips',
    folderName: 'Clips',
    folderPath: 'Clips',
    folderBreadcrumb: null,
    filename: `clip-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    thumbnailUrl: '/thumb.webp',
    previewUrl: '/video.mp4',
    sortTimestamp: id,
    takenAt: id
  };
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

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

  it('renders every row while no layout is measurable', () => {
    const wrapper = mount(FeedList, {
      props: { context: 'home', items: Array.from({ length: 40 }, (_, index) => videoItem(index + 1)) },
      global: { stubs: { FeedCard: FeedCardStub } }
    });

    expect(wrapper.findAll('[data-feed-window-id]')).toHaveLength(40);
    expect(wrapper.element.style.paddingTop).toBe('');
  });

  it('mounts only the rows near the viewport and holds the rest with padding', async () => {
    const wrapper = mount(FeedList, {
      props: { context: 'home', items: Array.from({ length: 40 }, (_, index) => videoItem(index + 1)) },
      attachTo: document.body,
      global: { stubs: { FeedCard: FeedCardStub } }
    });

    const column = wrapper.element as HTMLElement;
    Object.defineProperty(column, 'clientWidth', { configurable: true, value: 470 });
    // The reader has scrolled roughly five viewports into the feed.
    column.getBoundingClientRect = () => ({ top: -5000, bottom: 0, left: 0, right: 470, width: 470, height: 0, x: 0, y: -5000, toJSON: () => ({}) });

    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    await wrapper.vm.$nextTick();

    const rendered = wrapper.findAll('[data-feed-window-id]');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(12);

    const renderedIds = rendered.map((node) => Number(node.attributes('data-feed-window-id')));
    expect(renderedIds).not.toContain(1);
    expect(renderedIds).not.toContain(40);
    // Contiguous slice, so the column's padding can stand in for everything else.
    expect(renderedIds).toEqual(renderedIds.map((_, offset) => renderedIds[0] + offset));

    expect(Number.parseFloat(column.style.paddingTop)).toBeGreaterThan(0);
    expect(Number.parseFloat(column.style.paddingBottom)).toBeGreaterThan(0);

    wrapper.unmount();
  });

  it('keeps its window and its height while the view is cached behind another tab', async () => {
    const wrapper = mount(FeedList, {
      props: { context: 'home', items: Array.from({ length: 40 }, (_, index) => videoItem(index + 1)) },
      attachTo: document.body,
      global: { stubs: { FeedCard: FeedCardStub } }
    });

    const column = wrapper.element as HTMLElement;
    Object.defineProperty(column, 'clientWidth', { configurable: true, value: 470 });
    column.getBoundingClientRect = () => ({ top: -5000, bottom: 0, left: 0, right: 470, width: 470, height: 0, x: 0, y: -5000, toJSON: () => ({}) });

    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    await wrapper.vm.$nextTick();

    const windowedIds = wrapper.findAll('[data-feed-window-id]').map((node) => Number(node.attributes('data-feed-window-id')));
    const paddingTop = column.style.paddingTop;
    const paddingBottom = column.style.paddingBottom;
    expect(windowedIds.length).toBeLessThan(12);

    // Tapping another dock destination makes KeepAlive detach this column, which the resize
    // observer reports as a 0x0 box. The hidden feed must not rebuild all forty cards, and
    // the column has to stay as tall as it was or scroll restoration lands at the top.
    Object.defineProperty(column, 'clientWidth', { configurable: true, value: 0 });
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    await wrapper.vm.$nextTick();

    const hiddenIds = wrapper.findAll('[data-feed-window-id]').map((node) => Number(node.attributes('data-feed-window-id')));
    expect(hiddenIds).toEqual(windowedIds);
    expect(column.style.paddingTop).toBe(paddingTop);
    expect(column.style.paddingBottom).toBe(paddingBottom);

    wrapper.unmount();
  });

  it('freezes the window on the card whose player the immersive layer claimed', async () => {
    const items = Array.from({ length: 40 }, (_, index) => videoItem(index + 1));
    const wrapper = mount(FeedList, {
      props: { context: 'home', items },
      attachTo: document.body,
      global: { stubs: { FeedCard: FeedCardStub } }
    });

    const column = wrapper.element as HTMLElement;
    Object.defineProperty(column, 'clientWidth', { configurable: true, value: 470 });
    let columnTop = -5000;
    column.getBoundingClientRect = () => ({ top: columnTop, bottom: 0, left: 0, right: 470, width: 470, height: 0, x: 0, y: columnTop, toJSON: () => ({}) });

    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    await wrapper.vm.$nextTick();

    const renderedIds = wrapper.findAll('[data-feed-window-id]').map((node) => Number(node.attributes('data-feed-window-id')));
    const claimedId = renderedIds[Math.floor(renderedIds.length / 2)];

    const surface = useSharedVideoSurfaceStore();
    surface.register(`feed:${claimedId}`, {} as never);
    expect(surface.claim(`feed:${claimedId}`)).toBe(true);
    await wrapper.vm.$nextTick();

    // The reader is inside fullscreen; whatever moves the feed behind it must not unmount
    // the card that owns the shared decoder, and must not drag the whole list back in.
    columnTop = -60000;
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    await wrapper.vm.$nextTick();

    const afterIds = wrapper.findAll('[data-feed-window-id]').map((node) => Number(node.attributes('data-feed-window-id')));
    expect(afterIds).toContain(claimedId);
    expect(afterIds).toEqual(renderedIds);

    surface.release();
    await wrapper.vm.$nextTick();
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    await wrapper.vm.$nextTick();

    const releasedIds = wrapper.findAll('[data-feed-window-id]').map((node) => Number(node.attributes('data-feed-window-id')));
    expect(releasedIds).not.toContain(claimedId);

    wrapper.unmount();
  });
});

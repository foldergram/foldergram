import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { i18n } from '../locales';
import type { PostMediaItem } from '../types/api';
import CarouselMediaStage from './CarouselMediaStage.vue';

describe('CarouselMediaStage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mockItems: PostMediaItem[] = [
    {
      imageId: 1,
      filename: 'slide1.mp4',
      mediaType: 'video',
      width: 1080,
      height: 1080,
      previewUrl: '/preview1.mp4',
      thumbnailUrl: '/thumb1.webp',
      originalUrl: '/original1.mp4',
      position: 1
    },
    {
      imageId: 2,
      filename: 'slide2.jpg',
      mediaType: 'image',
      width: 1080,
      height: 1080,
      previewUrl: '/preview2.jpg',
      thumbnailUrl: '/thumb2.webp',
      originalUrl: '/original2.jpg',
      position: 2
    }
  ];

  it('renders video slides using VideoMediaPlayer and navigates between slides', async () => {
    const wrapper = mount(CarouselMediaStage, {
      props: {
        items: mockItems,
        modelValue: 0,
        autoplay: true
      },
      global: {
        plugins: [i18n]
      }
    });

    const player = wrapper.findComponent({ name: 'VideoMediaPlayer' });
    expect(player.exists()).toBe(true);
    expect(player.props('autoplay')).toBe(true);

    const nextBtn = wrapper.find('button[aria-label="Next carousel item"]');
    expect(nextBtn.exists()).toBe(true);
    await nextBtn.trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([1]);
  });

  it('ignores pointer swipes when initiated on controls with data-swipe-ignore', async () => {
    const wrapper = mount(CarouselMediaStage, {
      props: {
        items: mockItems,
        modelValue: 0
      },
      global: {
        plugins: [i18n]
      }
    });

    const root = wrapper.element as HTMLElement;
    const progressFooter = wrapper.find('.video-progress-footer');
    expect(progressFooter.exists()).toBe(true);

    // Trigger pointerdown on progress footer (data-swipe-ignore="true")
    await progressFooter.trigger('pointerdown', {
      pointerId: 1,
      clientX: 200,
      button: 0
    });

    // Trigger pointerup with horizontal movement
    await wrapper.trigger('pointerup', {
      pointerId: 1,
      clientX: 50
    });

    // Should NOT have navigated because pointerdown was on an ignored element
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('keeps the first slide aspect ratio in feeds and lets the viewer contain mixed slide sizes', async () => {
    const items = [
      { ...mockItems[1], imageId: 1, width: 2880, height: 1800 },
      { ...mockItems[1], imageId: 2, width: 1200, height: 1800 }
    ];
    const wrapper = mount(CarouselMediaStage, {
      props: { items, preferPreview: true },
      global: { plugins: [i18n] }
    });
    expect((wrapper.element as HTMLElement).style.aspectRatio).toBe('2880 / 1800');
    await wrapper.setProps({ modelValue: 1 });
    expect((wrapper.element as HTMLElement).style.aspectRatio).toBe('2880 / 1800');
    expect(wrapper.get('img').attributes('src')).toBe(items[1].previewUrl);

    await wrapper.setProps({ fitContainer: true });
    expect((wrapper.element as HTMLElement).style.aspectRatio).toBe('auto');
    expect(wrapper.get('img').attributes('width')).toBe('1200');
    expect(wrapper.get('img').attributes('height')).toBe('1800');
  });
});

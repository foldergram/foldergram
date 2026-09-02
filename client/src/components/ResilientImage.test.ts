import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ResilientImage from './ResilientImage.vue';

describe('ResilientImage', () => {
  it('falls back to the original source when the preview source fails', async () => {
    const wrapper = mount(ResilientImage, {
      props: {
        src: '/previews/NaturePlanet/pexels-photo-2770371.webp',
        fallbackSrc: '/api/originals/2770371',
        alt: 'NaturePlanet preview',
        loading: 'eager'
      }
    });

    expect(wrapper.get('img').attributes('src')).toContain('/previews/NaturePlanet/pexels-photo-2770371.webp');

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toContain('/api/originals/2770371');
  });

  it('uses a temporary video first-frame probe when the cover is missing', async () => {
    const wrapper = mount(ResilientImage, {
      props: {
        src: '',
        videoSrc: '/api/originals/91',
        alt: 'Video without cover',
        loading: 'eager'
      }
    });

    await nextTick();

    expect(wrapper.findComponent({ name: 'VideoFirstFrame' }).exists()).toBe(true);
    expect(wrapper.find('video').attributes('src')).toBe('/api/originals/91');
  });
});

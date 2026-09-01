import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import VideoProgressFooter from './VideoProgressFooter.vue';

describe('VideoProgressFooter', () => {
  it('maps a rotated visual timeline from screen Y to its playback position', async () => {
    const wrapper = mount(VideoProgressFooter, {
      props: {
        timeLabel: '0:00 / 2:00',
        seekOrientation: 'rotated',
        currentTime: 0,
        duration: 120
      }
    });

    const slider = wrapper.get('[role="slider"]').element as HTMLElement;
    Object.assign(slider, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      getBoundingClientRect: () => new DOMRect(40, 100, 20, 300)
    });

    await wrapper.get('[role="slider"]').trigger('pointerdown', {
      pointerId: 7,
      clientX: 44,
      clientY: 250
    });

    expect(wrapper.emitted('seek')).toBeUndefined();
    expect(wrapper.emitted('seek-preview')?.[0]).toEqual([60]);

    await wrapper.get('[role="slider"]').trigger('pointerup', {
      pointerId: 7,
      clientX: 44,
      clientY: 250
    });

    expect(wrapper.emitted('seek')?.[0]).toEqual([60]);
  });
});

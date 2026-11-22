import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LocalVideoFeedback from './LocalVideoFeedback.vue';

enableAutoUnmount(afterEach);
afterEach(() => vi.useRealTimers());

const pending = { pending: true, hasFrame: false, failed: false };
const spinner = '[role="status"]';

function mountFeedback(spinnerDelay?: number) {
  return mount(LocalVideoFeedback, {
    props: { poster: '/thumbnails/reel.webp', state: pending, spinnerDelay },
    attachTo: document.body
  });
}

describe('LocalVideoFeedback', () => {
  it('keeps a quick startup on the cover until the frame arrives without flashing a spinner', async () => {
    vi.useFakeTimers();
    const wrapper = mountFeedback(650);
    await vi.advanceTimersByTimeAsync(649);
    expect(wrapper.get('img').isVisible()).toBe(true);
    expect(wrapper.find(spinner).exists()).toBe(false);

    await wrapper.setProps({ state: { ...pending, pending: false, hasFrame: true } });
    await vi.advanceTimersByTimeAsync(650);
    expect(wrapper.get('img').isVisible()).toBe(false);
    expect(wrapper.find(spinner).exists()).toBe(false);
  });

  it('shows the spinner only after a sustained load on the active Reel', async () => {
    vi.useFakeTimers();
    const wrapper = mountFeedback(650);
    await vi.advanceTimersByTimeAsync(400);
    await wrapper.setProps({ active: false });
    await vi.advanceTimersByTimeAsync(650);
    expect(wrapper.find(spinner).exists()).toBe(false);

    await wrapper.setProps({ active: true });
    await vi.advanceTimersByTimeAsync(649);
    expect(wrapper.find(spinner).exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.find(spinner).exists()).toBe(true);
    expect(wrapper.get('img').isVisible()).toBe(true);
  });

  it('shows a failure and Retry immediately even during the spinner delay', async () => {
    vi.useFakeTimers();
    const wrapper = mountFeedback(650);
    await wrapper.setProps({ state: { ...pending, pending: false, failed: true } });
    expect(wrapper.get('[role="alert"]').isVisible()).toBe(true);
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(650);
    expect(wrapper.find(spinner).exists()).toBe(false);
  });

  it('shows the spinner immediately by default', () => {
    expect(mountFeedback().find(spinner).exists()).toBe(true);
  });
});

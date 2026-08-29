import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useLandscapeStage } from './useLandscapeStage';

function withStage(options: Parameters<typeof useLandscapeStage>[0]) {
  const stage: { value: ReturnType<typeof useLandscapeStage> | null } = { value: null };

  const wrapper = mount(
    defineComponent({
      setup() {
        stage.value = useLandscapeStage(options);
        return () => h('div');
      }
    })
  );

  return { stage: stage.value!, wrapper };
}

describe('useLandscapeStage', () => {
  it('rotates in place without asking for fullscreen or an orientation lock', async () => {
    const requestFullscreen = vi.fn();
    const lock = vi.fn();
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen
    });
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: { lock, unlock: vi.fn() }
    });

    const { stage } = withStage({
      mode: 'rotate',
      getStage: () => document.documentElement
    });

    await stage.toggle();
    expect(stage.isRotated.value).toBe(true);
    expect(stage.isFullscreen.value).toBe(false);
    // Leaving the page is what broke the deck's scroll snapping and left the card
    // half off-screen after closing.
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();

    await stage.toggle();
    expect(stage.isRotated.value).toBe(false);
  });

  it('shares one rotation flag so every card in the deck agrees', async () => {
    const rotationState = ref(false);
    const first = withStage({ mode: 'rotate', rotationState, getStage: () => null });
    const second = withStage({ mode: 'rotate', rotationState, getStage: () => null });

    await first.stage.enter();
    expect(second.stage.isRotated.value).toBe(true);

    await second.stage.exit();
    expect(first.stage.isRotated.value).toBe(false);
  });
});

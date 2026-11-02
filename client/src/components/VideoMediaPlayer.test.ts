import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { i18n } from '../locales';
import VideoMediaPlayer from './VideoMediaPlayer.vue';

describe('VideoMediaPlayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders media player with VideoProgressFooter and swipe-ignore tags', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        poster: '/test-poster.webp',
        alt: 'test video'
      },
      global: {
        plugins: [i18n]
      }
    });

    expect(wrapper.find('media-player').exists()).toBe(true);
    expect(wrapper.find('media-provider').exists()).toBe(true);
    expect(wrapper.find('media-poster').exists()).toBe(true);
    expect(wrapper.find('.video-progress-footer').exists()).toBe(true);
    expect(wrapper.find('.video-progress-footer').attributes('data-swipe-ignore')).toBe('true');
  });

  it('forwards autoplay to the media player', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: true
      },
      global: {
        plugins: [i18n]
      }
    });

    expect((wrapper.find('media-player').element as any).autoPlay).toBe(true);
  });

  it('retries blocked audible autoplay while muted', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: false
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    playerEl.play = vi.fn().mockResolvedValue(undefined);
    playerEl.dispatchEvent(new CustomEvent('auto-play-fail'));
    await vi.waitFor(() => expect(playerEl.play).toHaveBeenCalled());

    expect(playerEl.muted).toBe(true);
    expect(wrapper.emitted('autoplay-muted')).toHaveLength(1);
  });

  it('evaluates HD eligibility based on playbackStrategy, dimensions, and originalUrl', async () => {
    // Eligible: playbackStrategy: original, large resolution (downscaled preview), originalUrl present
    const wrapperEligible = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video-preview.mp4',
        originalUrl: '/test-video-original.mp4',
        playbackStrategy: 'original',
        width: 1920,
        height: 1080
      },
      global: {
        plugins: [i18n]
      }
    });

    const hdBtn = wrapperEligible.find('button[data-swipe-ignore="true"]');
    expect(hdBtn.exists()).toBe(true);
    expect(hdBtn.classes()).not.toContain('video-media-player__control--active');

    // Ineligible: playbackStrategy is preview (not compatible for direct playback)
    const wrapperIneligibleStrategy = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video-preview.mp4',
        originalUrl: '/test-video-original.mov',
        playbackStrategy: 'preview',
        width: 1920,
        height: 1080
      },
      global: {
        plugins: [i18n]
      }
    });
    expect(wrapperIneligibleStrategy.find('button[data-swipe-ignore="true"]').exists()).toBe(false);

    // Ineligible: small resolution that did not downscale
    const wrapperIneligibleSize = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video-preview.mp4',
        originalUrl: '/test-video-original.mp4',
        playbackStrategy: 'original',
        width: 640,
        height: 480
      },
      global: {
        plugins: [i18n]
      }
    });
    expect(wrapperIneligibleSize.find('button[data-swipe-ignore="true"]').exists()).toBe(false);
  });

  it('hides the HD switch when normal playback already uses the original', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video-original.mp4',
        originalUrl: '/test-video-original.mp4',
        playbackStrategy: 'original',
        videoPlaybackSource: 'original',
        width: 1920,
        height: 1080
      },
      global: {
        plugins: [i18n]
      }
    });

    expect(wrapper.find('button[aria-label="Switch to HD original"]').exists()).toBe(false);
  });

  it('toggles HD state and resets when src changes', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video-preview.mp4',
        originalUrl: '/test-video-original.mp4',
        playbackStrategy: 'original',
        width: 1920,
        height: 1080
      },
      global: {
        plugins: [i18n]
      }
    });

    const hdBtn = wrapper.find('button[data-swipe-ignore="true"]');
    await hdBtn.trigger('click');
    expect(wrapper.emitted('toggle-hd')?.[0]).toEqual([true]);
    expect(wrapper.vm.isHd).toBe(true);

    // Change slide / preview src -> should reset isHd
    await wrapper.setProps({ src: '/another-video.mp4', originalUrl: '/another-original.mp4' });
    expect(wrapper.vm.isHd).toBe(false);
  });

  it('restores currentTime and playing state after HD toggle when loaded-metadata fires', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video-preview.mp4',
        originalUrl: '/test-video-original.mp4',
        playbackStrategy: 'original',
        width: 1920,
        height: 1080
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    playerEl.currentTime = 42.5;
    playerEl.paused = false; // playing before toggle
    playerEl.play = vi.fn().mockResolvedValue(undefined);

    const hdBtn = wrapper.find('button[data-swipe-ignore="true"]');
    await hdBtn.trigger('click');

    // Simulate loaded-metadata event on media player after source changed
    playerEl.dispatchEvent(new Event('loaded-metadata'));

    expect(playerEl.currentTime).toBe(42.5);
    expect(playerEl.play).toHaveBeenCalled();
  });

  it('stops keyboard event propagation for arrow keys on controls', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4'
      },
      global: {
        plugins: [i18n]
      }
    });

    const muteBtn = wrapper.find('media-mute-button');
    const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
    const stopPropagationSpy = vi.spyOn(keyEvent, 'stopPropagation');

    muteBtn.element.dispatchEvent(keyEvent);
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('pauses player on unmount', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4'
      },
      global: {
        plugins: [i18n]
      }
    });

    const mockPlayer = { pause: vi.fn(), removeEventListener: vi.fn() };
    (wrapper.vm as any).playerElement = mockPlayer;

    wrapper.unmount();
    expect(mockPlayer.pause).toHaveBeenCalled();
  });
});

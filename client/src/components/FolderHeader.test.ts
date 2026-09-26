import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FolderSummary } from '../types/api';
import { useAuthStore } from '../stores/auth';
import FolderHeader from './FolderHeader.vue';

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');

  return {
    ...actual,
    useRoute: () => ({
      fullPath: '/folders/animal-planet',
      query: {}
    })
  };
});

function createFolder(overrides: Partial<FolderSummary> = {}): FolderSummary {
  return {
    id: 7,
    slug: 'animal-planet',
    name: 'Animal Planet',
    description: 'Wildlife notes from the ridge line.',
    folderPath: 'animals/big-cats',
    breadcrumb: 'Animals / Big Cats',
    imageCount: 3,
    videoCount: 1,
    latestImageMtimeMs: 1_777_000_000_000,
    avatarImageId: null,
    avatarUrl: null,
    ...overrides
  };
}

describe('FolderHeader', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('shows the share button only to admins', async () => {
    const adminWrapper = mount(FolderHeader, {
      props: {
        folder: createFolder()
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          FolderProfileModal: {
            template: '<div data-test="folder-profile-modal" />'
          },
          FolderShareModal: {
            template: '<div data-test="folder-share-modal" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    expect(adminWrapper.find('button[aria-label="Share folder"]').exists()).toBe(true);

    setActivePinia(createPinia());
    const authStore = useAuthStore();
    authStore.applyStatus({
      enabled: true,
      authenticated: false,
      role: 'anonymous',
      accessMode: 'off',
      likesMode: 'local',
      defaultLocale: null,
      patternUnlock: false,
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: false,
        canUseLocalFavorites: true,
        canUseSharedCollections: false,
        canUseLocalCollections: true
      }
    });

    const viewerWrapper = mount(FolderHeader, {
      props: {
        folder: createFolder()
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          FolderProfileModal: {
            template: '<div data-test="folder-profile-modal" />'
          },
          FolderShareModal: {
            template: '<div data-test="folder-share-modal" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    expect(viewerWrapper.find('button[aria-label="Share folder"]').exists()).toBe(false);
  });

  it('keeps the description expanded during same-folder description edits', async () => {
    const wrapper = mount(FolderHeader, {
      props: {
        folder: createFolder()
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          FolderProfileModal: {
            template: '<div data-test="folder-profile-modal" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    await flushPromises();

    const description = wrapper.get('p[id^="folder-description-"]').element as HTMLParagraphElement;
    Object.defineProperty(description, 'clientHeight', {
      configurable: true,
      get: () => 40
    });
    Object.defineProperty(description, 'scrollHeight', {
      configurable: true,
      get: () => 80
    });

    await wrapper.setProps({
      folder: createFolder({
        description: 'Wildlife notes from the ridge line. Updated with a second sentence.'
      })
    });
    await flushPromises();

    const toggle = wrapper.get('button[aria-label="Expand description"]');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-expanded')).toBe('true');

    await wrapper.setProps({
      folder: createFolder({
        description: 'Wildlife notes from the ridge line. Updated again without navigating away.'
      })
    });
    await flushPromises();

    expect(wrapper.get('button[aria-label="Collapse description"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('.folder-description--collapsed').exists()).toBe(false);
  });
});

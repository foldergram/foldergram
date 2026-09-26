import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../locales';
import { useAuthStore } from '../stores/auth';
import PatternLockGate from './PatternLockGate.vue';

vi.mock('./PatternPad.vue', () => ({
  default: {
    emits: ['complete'],
    template: '<button type="button" data-test="pattern-pad" @click="$emit(\'complete\', \'0-1-2\')" />'
  }
}));

describe('PatternLockGate', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.sessionStorage.clear();
  });

  it('covers the screen with only the pattern pad until too many failed attempts', async () => {
    const authStore = useAuthStore();
    authStore.$patch({
      enabled: true,
      patternUnlock: true,
      patternSessionUnlocked: false,
      loading: false
    });
    vi.spyOn(authStore, 'unlockPattern').mockRejectedValue(new Error('Incorrect pattern.'));

    const wrapper = mount(PatternLockGate, {
      global: {
        plugins: [i18n]
      }
    });

    expect(wrapper.find('.pattern-gate').exists()).toBe(true);
    expect(wrapper.find('[data-test="pattern-pad"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain(i18n.global.t('auth.patternGate.forgotPattern'));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await wrapper.get('[data-test="pattern-pad"]').trigger('click');
      await flushPromises();
    }

    expect(wrapper.text()).toContain(i18n.global.t('auth.patternGate.forgotPattern'));
  });
});

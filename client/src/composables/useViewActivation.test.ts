import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { provideViewActivation, useViewActive } from './useViewActivation';

const observedStates: string[] = [];

const MediaChild = defineComponent({
  name: 'MediaChild',
  setup() {
    const isActive = useViewActive();
    return () => {
      const state = isActive.value ? 'active' : 'inactive';
      observedStates.push(state);
      return h('span', { 'data-test': 'child' }, state);
    };
  }
});

const CachedView = defineComponent({
  name: 'CachedView',
  setup() {
    provideViewActivation();
    return () => h(MediaChild);
  }
});

const OtherView = defineComponent({
  name: 'OtherView',
  setup() {
    return () => h('span', { 'data-test': 'other' }, 'other');
  }
});

describe('useViewActivation', () => {
  it('flips to inactive while a cached view is deactivated and back on return', async () => {
    const showCached = ref(true);
    const wrapper = mount(
      defineComponent({
        setup() {
          return () => h(KeepAlive, null, [showCached.value ? h(CachedView) : h(OtherView)]);
        }
      })
    );

    expect(wrapper.get('[data-test="child"]').text()).toBe('active');

    observedStates.length = 0;
    showCached.value = false;
    await nextTick();

    // The cached view is still mounted, so its descendants must learn they are hidden
    // rather than keep decoding media in the background.
    expect(wrapper.get('[data-test="other"]').exists()).toBe(true);
    expect(observedStates).toContain('inactive');

    observedStates.length = 0;
    showCached.value = true;
    await nextTick();

    expect(wrapper.get('[data-test="child"]').text()).toBe('active');
    expect(observedStates).toContain('active');
  });

  it('reports active for components mounted outside a cached view', () => {
    observedStates.length = 0;
    const wrapper = mount(MediaChild);

    expect(wrapper.get('[data-test="child"]').text()).toBe('active');
  });
});

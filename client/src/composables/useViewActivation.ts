import { inject, onActivated, onDeactivated, provide, readonly, ref, type InjectionKey, type Ref } from 'vue';

const VIEW_ACTIVE_KEY: InjectionKey<Ref<boolean>> = Symbol('foldergram-view-active');

/**
 * Marks a `<KeepAlive>` route as active or deactivated and shares that flag with its
 * media descendants.
 *
 * A cached view is detached from the document rather than unmounted, so a
 * `<media-player>` inside it keeps decoding and keeps playing audio after the user
 * taps another dock destination. Descendants read this flag to stand down instead.
 */
export function provideViewActivation(): Ref<boolean> {
  const isActive = ref(true);

  onActivated(() => {
    isActive.value = true;
  });

  onDeactivated(() => {
    isActive.value = false;
  });

  provide(VIEW_ACTIVE_KEY, readonly(isActive) as Ref<boolean>);
  return isActive;
}

/**
 * Reads the enclosing view's activation flag. Components outside a cached route (the
 * immersive layers, share pages, modals) get `true`, so their behaviour is unchanged.
 */
export function useViewActive(): Ref<boolean> {
  return inject(VIEW_ACTIVE_KEY, ref(true));
}

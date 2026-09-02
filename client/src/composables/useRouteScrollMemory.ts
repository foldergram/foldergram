import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';

interface RouteScrollMemoryOptions {
  key: string;
  getScroller?: () => HTMLElement | null;
}

const positions = new Map<string, number>();

export function useRouteScrollMemory(options: RouteScrollMemoryOptions) {
  const attachedScroller = ref<HTMLElement | null>(null);
  let frame = 0;

  function savePosition() {
    positions.set(options.key, options.getScroller?.()?.scrollTop ?? window.scrollY);
  }

  function handleScroll() {
    if (frame !== 0) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      savePosition();
    });
  }

  function detach() {
    attachedScroller.value?.removeEventListener('scroll', handleScroll);
    attachedScroller.value = null;
    window.removeEventListener('scroll', handleScroll);
  }

  function attach() {
    detach();
    const scroller = options.getScroller?.();
    if (scroller) {
      attachedScroller.value = scroller;
      scroller.addEventListener('scroll', handleScroll, { passive: true });
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }
  }

  async function restore() {
    await nextTick();
    const position = positions.get(options.key) ?? 0;
    const scroller = options.getScroller?.();
    if (scroller) {
      scroller.scrollTop = position;
    } else {
      window.scrollTo({ top: position, behavior: 'auto' });
    }
  }

  function activate() {
    attach();
    void restore();
  }

  onMounted(activate);
  onActivated(activate);
  onDeactivated(() => {
    savePosition();
    detach();
  });
  onBeforeUnmount(() => {
    savePosition();
    detach();
    if (frame !== 0) window.cancelAnimationFrame(frame);
  });

  return { restore };
}

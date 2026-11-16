<template>
  <dialog
    v-if="mobile"
    id="scan-activity-details"
    ref="dialog"
    class="scan-activity-sheet max-h-[80dvh] overflow-y-auto rounded-t-[1.25rem] border border-border bg-surface text-text"
    aria-labelledby="scan-activity-heading"
    @cancel.prevent="$emit('dismiss')"
    @click.self="$emit('dismiss')"
  >
    <div class="grid gap-4 p-4"><slot /></div>
  </dialog>
  <section
    v-else
    id="scan-activity-details"
    ref="popover"
    class="fixed z-50 grid max-h-[calc(100dvh-2rem)] w-[min(24rem,calc(100vw-2rem))] gap-4 overflow-y-auto rounded-[1.1rem] border border-border bg-surface p-4 text-text shadow-[var(--shadow)]"
    :style="position"
    role="dialog"
    aria-labelledby="scan-activity-heading"
  >
    <slot />
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue';

const props = defineProps<{ mobile: boolean; anchor: HTMLElement }>();
const emit = defineEmits<{ dismiss: [restoreFocus?: boolean] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const popover = ref<HTMLElement | null>(null);
let anchorObserver: ResizeObserver | undefined;
const position = ref<CSSProperties>({ right: '1rem', bottom: '1rem' });

function positionPopover() {
  if (!popover.value || !props.anchor.isConnected) return;
  const rect = props.anchor.getBoundingClientRect();
  const width = popover.value.offsetWidth;
  const preferredLeft = rect.right + 8 + width <= window.innerWidth - 16 ? rect.right + 8 : rect.left;
  const left = Math.max(16, Math.min(preferredLeft, window.innerWidth - width - 16));
  const bottom = Math.max(16, Math.min(window.innerHeight - rect.bottom, window.innerHeight - popover.value.offsetHeight - 16));
  position.value = { left: left + 'px', bottom: bottom + 'px' };
}

function onPointerDown(event: PointerEvent) {
  if (!(event.target instanceof Node) || popover.value?.contains(event.target) || props.anchor.contains(event.target)) return;
  emit('dismiss', false);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  emit('dismiss');
}

onMounted(async () => {
  if (dialog.value) {
    dialog.value.showModal();
    return;
  }

  positionPopover();
  if (typeof ResizeObserver !== 'undefined') {
    anchorObserver = new ResizeObserver(positionPopover);
    anchorObserver.observe(props.anchor);
  }
  await nextTick();
  if (!popover.value) return;
  popover.value.querySelector<HTMLElement>('[data-scan-close]')?.focus();
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', positionPopover);
});

onBeforeUnmount(() => {
  anchorObserver?.disconnect();
  if (dialog.value?.open) dialog.value.close();
  window.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', positionPopover);
});
</script>

<style scoped>
.scan-activity-sheet {
  position: fixed;
  inset: auto 0 0;
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0 0 env(safe-area-inset-bottom, 0px);
}

.scan-activity-sheet::backdrop {
  background: rgb(0 0 0 / 42%);
}
</style>

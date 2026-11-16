import type { InjectionKey } from 'vue';

export const openScanActivityKey: InjectionKey<(event: MouseEvent) => void> = Symbol('openScanActivity');

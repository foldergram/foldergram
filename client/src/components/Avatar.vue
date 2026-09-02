<template>
  <div class="grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white [background:var(--avatar-fallback)]">
    <ResilientImage
      v-if="src"
      :src="src"
      :alt="name"
      loading="lazy"
      :retry-while="appStore.isInitialScan"
      class="h-full w-full object-cover"
    />
    <span v-else>{{ initials }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useAppStore } from '../stores/app';
import ResilientImage from './ResilientImage.vue';

const props = defineProps<{
  name: string;
  src: string | null;
}>();

const appStore = useAppStore();
const initials = computed(() =>
  props.name
    .split(' ')
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? '')
    .join('')
);
</script>

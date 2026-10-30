<template>
  <div class="video-progress-footer" :class="`video-progress-footer--${variant}`">
    <div class="video-progress-footer__meta">
      <div class="video-progress-footer__slot video-progress-footer__slot--leading">
        <slot name="leading" />
        <span class="video-progress-footer__time">{{ timeLabel }}</span>
      </div>
      <div class="video-progress-footer__slot video-progress-footer__slot--trailing">
        <slot name="trailing" />
      </div>
    </div>

    <div class="video-progress-footer__timeline-shell">
      <media-time-slider
        class="vds-slider vds-time-slider video-progress-footer__slider"
        :aria-label="t('media.seekVideo')"
      >
        <div class="vds-slider-track video-progress-footer__track" />
        <div class="vds-slider-track vds-slider-progress video-progress-footer__track-progress" />
        <div class="vds-slider-track vds-slider-track-fill video-progress-footer__track-fill" />
        <div class="vds-slider-thumb video-progress-footer__thumb" />
      </media-time-slider>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

withDefaults(
  defineProps<{
    timeLabel: string;
    variant?: 'feed' | 'viewer';
  }>(),
  {
    variant: 'feed'
  }
);

const { t } = useI18n();
</script>

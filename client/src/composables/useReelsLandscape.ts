import { ref } from 'vue';

/**
 * Shared between every reel card so turning the picture landscape survives a
 * swipe: the deck keeps the viewer on the same rotation until they toggle back.
 */
export const reelsLandscapeRotation = ref(false);

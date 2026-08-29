import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { createPostShareLink } from '../api/gallery';

/**
 * Mints a post-level share link and puts it on the clipboard.
 *
 * Folder shares unlock a whole album; this hands out exactly one post, which is what a
 * viewer means when they tap share on a single clip. The server decides whether the URL
 * carries the LAN origin or the configured public base URL, so nothing here has to guess
 * how the recipient will reach the NAS.
 */
export function usePostShare() {
  const { t } = useI18n();
  const sharing = ref(false);
  const shareUrl = ref<string | null>(null);
  const error = ref<string | null>(null);
  const copied = ref(false);
  let copiedTimer = 0;

  function reset() {
    shareUrl.value = null;
    error.value = null;
    copied.value = false;

    if (copiedTimer !== 0) {
      window.clearTimeout(copiedTimer);
      copiedTimer = 0;
    }
  }

  async function copyToClipboard(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // `navigator.clipboard` needs a secure context, and a NAS on plain http is not one,
      // so the legacy path is the one that actually runs on the LAN.
      try {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.append(textArea);
        textArea.select();
        const copiedOk = document.execCommand('copy');
        textArea.remove();
        return copiedOk;
      } catch {
        return false;
      }
    }
  }

  async function share(postId: number): Promise<string | null> {
    if (sharing.value) {
      return null;
    }

    sharing.value = true;
    error.value = null;
    copied.value = false;

    try {
      const result = await createPostShareLink(postId);
      shareUrl.value = result.shareUrl;
      copied.value = await copyToClipboard(result.shareUrl);

      if (copied.value) {
        if (copiedTimer !== 0) {
          window.clearTimeout(copiedTimer);
        }

        copiedTimer = window.setTimeout(() => {
          copied.value = false;
          copiedTimer = 0;
        }, 2_400);
      }

      return result.shareUrl;
    } catch (shareError) {
      error.value = shareError instanceof Error ? shareError.message : t('share.post.createError');
      return null;
    } finally {
      sharing.value = false;
    }
  }

  return { sharing, shareUrl, error, copied, share, reset };
}

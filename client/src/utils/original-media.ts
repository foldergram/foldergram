export function isHeicFilename(filename: string): boolean {
  return /\.hei[cf]$/i.test(filename);
}

/** HEIC by extension, or HEIC content the server found behind another extension (`IMG_1234.HEIC.jpeg`). */
export function isHeicMedia(media: { filename: string; mimeType?: string | null }): boolean {
  return isHeicFilename(media.filename) || media.mimeType === 'image/heic' || media.mimeType === 'image/heif';
}

export function needsWebpViewing(media: { filename: string; mimeType?: string | null; previewUrl?: string }): boolean {
  return isHeicMedia(media) && !media.previewUrl?.startsWith('/api/remote-media/');
}

export function getImageViewingFallback(media: {
  filename: string;
  mimeType?: string | null;
  previewUrl?: string;
  thumbnailUrl?: string;
  originalUrl?: string;
}): string | undefined {
  return needsWebpViewing(media) ? media.thumbnailUrl : media.originalUrl;
}

export function getOriginalMediaUrl(id: number): string {
  return `/api/originals/${id}`;
}

export function getOriginalMediaDownloadUrl(id: number): string {
  return `${getOriginalMediaUrl(id)}?download=1`;
}

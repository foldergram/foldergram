export function isHeicFilename(filename: string): boolean {
  return /\.hei[cf]$/i.test(filename);
}

export function needsWebpViewing(media: { filename: string; previewUrl?: string }): boolean {
  return isHeicFilename(media.filename) && !media.previewUrl?.startsWith('/api/remote-media/');
}

export function getImageViewingFallback(media: {
  filename: string;
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

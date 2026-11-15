import { getLocalSource, primaryLocalSource, resolveLocalPath } from '../sources/local-source.js';

export function resolveOriginalPath(relativePath: string, sourceId?: number | null, allowMissing = false): string {
  const source = sourceId == null ? primaryLocalSource() : getLocalSource(sourceId);
  if (!source) throw new Error('The requested file is unavailable.');
  return resolveLocalPath(source, relativePath, { allowMissing });
}

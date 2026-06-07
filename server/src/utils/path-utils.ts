import path from 'node:path';

const HIDDEN_SEGMENT_PATTERN = /^\./;
const PATH_EDGE_SLASH_PATTERN = /^\/+|\/+$/g;

export function normalizePath(value: string): string {
  return (value ?? '').replace(/\\/g, '/');
}

function trimEdgeSlashes(value: string): string {
  return normalizePath(value).replace(PATH_EDGE_SLASH_PATTERN, '');
}

export function splitPathSegments(value: string): string[] {
  return trimEdgeSlashes(value)
    .split('/')
    .filter(Boolean);
}

export function toOsPath(value: string): string {
  return path.normalize(value);
}

export function isHiddenPath(value: string): boolean {
  return splitPathSegments(value).some((segment) => HIDDEN_SEGMENT_PATTERN.test(segment));
}

export function ensureWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isSameOrWithinPath(root: string, target: string): boolean {
  return ensureWithinRoot(root, target);
}

export function getRelativePathWithinRoot(root: string, target: string): string | null {
  const relative = normalizePath(path.relative(root, target));
  if (relative === '') {
    return '';
  }

  if (relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) {
    return null;
  }

  return trimEdgeSlashes(relative);
}

export function isWithinRelativeRoot(relativePath: string, rootRelativePath: string): boolean {
  const normalizedRelativePath = trimEdgeSlashes(relativePath);
  const normalizedRoot = trimEdgeSlashes(rootRelativePath);

  if (!normalizedRelativePath || !normalizedRoot) {
    return false;
  }

  return normalizedRelativePath === normalizedRoot || normalizedRelativePath.startsWith(`${normalizedRoot}/`);
}

export function matchesRelativeRoot(relativePath: string, relativeRoots: string[]): boolean {
  return relativeRoots.some((root) => isWithinRelativeRoot(relativePath, root));
}

export function safeJoin(root: string, relativePath: string): string {
  const targetPath = path.resolve(root, relativePath);
  if (!ensureWithinRoot(root, targetPath)) {
    throw new Error('Resolved path escapes configured root');
  }

  return targetPath;
}

export function getRelativeGalleryPath(galleryRoot: string, absolutePath: string): string {
  return normalizePath(path.relative(galleryRoot, absolutePath));
}

export function getSourceFolderPathFromRelativePath(relativePath: string): string | null {
  const normalized = trimEdgeSlashes(relativePath);
  if (!normalized) {
    return null;
  }

  const sourceFolderPath = path.posix.dirname(normalized);
  return sourceFolderPath === '.' ? null : sourceFolderPath;
}

export function getLeafPathName(relativePath: string): string {
  const segments = splitPathSegments(relativePath);
  return segments.at(-1) ?? 'folder';
}

export function getPathBreadcrumb(relativePath: string): string | null {
  const segments = splitPathSegments(relativePath);
  if (segments.length <= 1) {
    return null;
  }

  return segments.slice(0, -1).join(' / ');
}

export function getParentRelativePath(relativePath: string): string | null {
  const segments = splitPathSegments(relativePath);
  if (segments.length <= 1) {
    return null;
  }

  return segments.slice(0, -1).join('/');
}

export function getFolderDisplayInfo(relativePath: string): { name: string; breadcrumb: string | null } {
  return {
    name: getLeafPathName(relativePath),
    breadcrumb: getPathBreadcrumb(relativePath)
  };
}

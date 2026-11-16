import type { ExtractedImageExif } from '../../utils/exif-utils.js';

export interface SourceRevision {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

export function sameHeicRevision(a: SourceRevision, b: SourceRevision): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

export type HeicErrorKind = 'media' | 'busy' | 'stale' | 'infrastructure';

export class HeicError extends Error {
  constructor(public readonly kind: HeicErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HeicError';
  }
}

export interface HeicOutput {
  kind: 'thumbnail' | 'preview';
  temporaryPath: string;
}

export interface HeicWorkerRequest {
  sourcePath: string;
  revision: SourceRevision;
  maxInputBytes: number;
  maxPixels: number;
  outputs: HeicOutput[];
}

export interface HeicMetadata extends ExtractedImageExif {
  width: number;
  height: number;
  displayOrientation: number;
}

export type HeicWorkerResult =
  | { metadata: HeicMetadata }
  | { kind: HeicErrorKind; message: string };

import { describe, expect, it } from 'vitest';

import {
  createFolderScanSignature,
  resolveFullScanOptions,
  shouldQueueDerivativeJobForStatus,
  shouldRefreshUnchangedImage,
  shouldSkipFolderBySignature
} from '../src/utils/scan-utils.js';

describe('full scan options', () => {
  it('repairs unchanged derivatives by default for non-startup full scans', async () => {
    expect(resolveFullScanOptions()).toEqual({
      repairUnchangedDerivatives: true,
      forceNewFileDerivatives: true,
      allowDerivativeMigration: true
    });
    expect(shouldQueueDerivativeJobForStatus('unchanged', resolveFullScanOptions())).toBe(true);
  });

  it('skips unchanged derivative verification when startup disables repair', async () => {
    const startupOptions = resolveFullScanOptions({
      repairUnchangedDerivatives: false
    });

    expect(shouldQueueDerivativeJobForStatus('unchanged', startupOptions)).toBe(false);
  });

  it('always queues derivatives for new and updated files', async () => {
    const startupOptions = resolveFullScanOptions({
      repairUnchangedDerivatives: false
    });

    expect(shouldQueueDerivativeJobForStatus('new', startupOptions)).toBe(true);
    expect(shouldQueueDerivativeJobForStatus('updated', startupOptions)).toBe(true);
  });
});

describe('folder scan signatures', () => {
  it('creates stable signatures independent of discovery order', async () => {
    const first = createFolderScanSignature([
      { relativePath: 'cats/z.png', fileSize: 30, mtimeMs: 100.2 },
      { relativePath: 'cats/a.png', fileSize: 10, mtimeMs: 50.8 }
    ]);
    const second = createFolderScanSignature([
      { relativePath: 'cats/a.png', fileSize: 10, mtimeMs: 50.8 },
      { relativePath: 'cats/z.png', fileSize: 30, mtimeMs: 100.2 }
    ]);

    expect(first.signature).toBe(second.signature);
    expect(first.fileCount).toBe(2);
    expect(first.totalSize).toBe(40);
    expect(first.maxMtimeMs).toBe(100);
  });
});

describe('folder shortcut decisions', () => {
  it('only skips full folder processing when the stored signature matches on stable startup scans', async () => {
    expect(
      shouldSkipFolderBySignature({
        currentSignature: 'abc',
        galleryRootChanged: false,
        hasStoredGalleryRoot: true,
        hasMatchingIndexedFiles: true,
        repairUnchangedDerivatives: false,
        storedSignature: 'abc'
      })
    ).toBe(true);

    expect(
      shouldSkipFolderBySignature({
        currentSignature: 'abc',
        galleryRootChanged: true,
        hasStoredGalleryRoot: true,
        hasMatchingIndexedFiles: true,
        repairUnchangedDerivatives: false,
        storedSignature: 'abc'
      })
    ).toBe(false);

    expect(
      shouldSkipFolderBySignature({
        currentSignature: 'abc',
        galleryRootChanged: false,
        hasStoredGalleryRoot: true,
        hasMatchingIndexedFiles: true,
        repairUnchangedDerivatives: true,
        storedSignature: 'abc'
      })
    ).toBe(false);
  });

  it('does not shortcut when the active indexed rows are missing or stale', async () => {
    expect(
      shouldSkipFolderBySignature({
        currentSignature: 'abc',
        galleryRootChanged: false,
        hasStoredGalleryRoot: true,
        hasMatchingIndexedFiles: false,
        repairUnchangedDerivatives: false,
        storedSignature: 'abc'
      })
    ).toBe(false);
  });
});

describe('unchanged image refresh decisions', () => {
  it('refreshes unchanged rows when reactivation or path migration safety requires it', async () => {
    expect(
      shouldRefreshUnchangedImage({
        absolutePathChanged: false,
        galleryRootChanged: false,
        hasStoredGalleryRoot: false,
        isDeleted: false
      })
    ).toBe(true);

    expect(
      shouldRefreshUnchangedImage({
        absolutePathChanged: false,
        galleryRootChanged: false,
        hasStoredGalleryRoot: true,
        isDeleted: true
      })
    ).toBe(true);

    expect(
      shouldRefreshUnchangedImage({
        absolutePathChanged: true,
        galleryRootChanged: true,
        hasStoredGalleryRoot: true,
        isDeleted: false
      })
    ).toBe(true);
  });

  it('skips unchanged row refreshes when the gallery root is stable and the row is already active', async () => {
    expect(
      shouldRefreshUnchangedImage({
        absolutePathChanged: false,
        galleryRootChanged: false,
        hasStoredGalleryRoot: true,
        isDeleted: false
      })
    ).toBe(false);
  });
});

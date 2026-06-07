import { describe, expect, it } from 'vitest';

import { deserializeImageExifData, normalizeTakenAtValue, resolveTakenAt, serializeImageExifData } from '../src/utils/exif-utils.js';

describe('EXIF timestamp helpers', () => {
  it('normalizes Date, ISO string, and numeric values', () => {
    expect(normalizeTakenAtValue(new Date('2024-03-14T09:26:53Z'))).toBe(Date.parse('2024-03-14T09:26:53Z'));
    expect(normalizeTakenAtValue('2024-03-14T09:26:53Z')).toBe(Date.parse('2024-03-14T09:26:53Z'));
    expect(normalizeTakenAtValue(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(normalizeTakenAtValue('not-a-date')).toBeNull();
  });

  it('prefers EXIF capture time and tracks source provenance', async () => {
    expect(
      resolveTakenAt({
        exifTakenAt: 3600,
        existingTakenAt: 1200,
        existingTakenAtSource: 'mtime',
        existingSortTimestamp: 1200,
        existingFirstSeenAt: '2024-03-10T00:00:00.000Z',
        existingMtimeMs: 1200,
        fileMtimeMs: 1200,
        firstSeenAt: '2024-03-10T00:00:00.000Z',
        stableFallbackTimestamp: 2400
      })
    ).toEqual({
      takenAt: 3600,
      source: 'exif'
    });
  });

  it('preserves or infers stable fallback provenance when EXIF is missing', async () => {
    expect(
      resolveTakenAt({
        exifTakenAt: null,
        existingTakenAt: 1200,
        existingTakenAtSource: 'mtime',
        existingSortTimestamp: 1200,
        existingFirstSeenAt: '2024-03-10T00:00:00.000Z',
        existingMtimeMs: 1200,
        fileMtimeMs: 1200,
        firstSeenAt: '2024-03-10T00:00:00.000Z',
        stableFallbackTimestamp: 2400
      })
    ).toEqual({
      takenAt: 1200,
      source: 'mtime'
    });

    expect(
      resolveTakenAt({
        exifTakenAt: null,
        existingTakenAt: null,
        existingTakenAtSource: null,
        existingSortTimestamp: null,
        existingFirstSeenAt: null,
        existingMtimeMs: null,
        fileMtimeMs: 2400,
        firstSeenAt: '2024-03-10T00:00:00.000Z',
        stableFallbackTimestamp: 2400
      })
    ).toEqual({
      takenAt: 2400,
      source: 'mtime'
    });

    expect(
      resolveTakenAt({
        exifTakenAt: null,
        existingTakenAt: 1_710_028_800_000,
        existingTakenAtSource: null,
        existingSortTimestamp: 1_710_028_800_000,
        existingFirstSeenAt: '2024-03-10T00:00:00.000Z',
        existingMtimeMs: 5000,
        fileMtimeMs: 5000,
        firstSeenAt: '2024-03-10T00:00:00.000Z',
        stableFallbackTimestamp: 1_710_028_800_000
      })
    ).toEqual({
      takenAt: 1_710_028_800_000,
      source: 'first_seen'
    });
  });

  it('serializes and deserializes curated EXIF payloads', async () => {
    const serialized = serializeImageExifData({
      cameraMake: 'Apple',
      cameraModel: 'iPhone 15 Pro',
      lensModel: '  ',
      fNumber: 1.78,
      exposureTimeSeconds: 1 / 120,
      iso: 80,
      focalLengthMm: Number.NaN,
      focalLength35mmMm: 24,
      latitude: 37.7749,
      longitude: -122.4194,
      altitudeMeters: 15.2
    });

    expect(serialized).not.toBeNull();
    expect(deserializeImageExifData(serialized)).toEqual({
      cameraMake: 'Apple',
      cameraModel: 'iPhone 15 Pro',
      fNumber: 1.78,
      exposureTimeSeconds: 1 / 120,
      iso: 80,
      focalLength35mmMm: 24,
      latitude: 37.7749,
      longitude: -122.4194,
      altitudeMeters: 15.2
    });
  });

  it('treats empty or invalid EXIF payloads as absent data', async () => {
    expect(serializeImageExifData(null)).toBeNull();
    expect(serializeImageExifData(null, { storeEmptyObject: true })).toBe('{}');
    expect(deserializeImageExifData('{}')).toBeNull();
    expect(deserializeImageExifData('not-json')).toBeNull();
  });
});

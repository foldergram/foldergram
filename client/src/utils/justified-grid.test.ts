import { describe, expect, it } from 'vitest';
import { justifiedTiles } from './justified-grid';

const images = [{ width: 6048, height: 4032 }, { width: 4032, height: 6048 }, { width: 6048, height: 4032 }, { width: 1920, height: 1080 }, { width: 4032, height: 6048 }];

describe('justifiedTiles', () => {
  it.each([320, 390, 768, 1200])('preserves proportions and fits rows at %dpx', width => {
    const tiles = justifiedTiles(images, width, Math.max(112, Math.min(220, width / 3.5)), 4);
    expect(tiles).toHaveLength(images.length);
    let used = 0;
    let height = tiles[0]!.height;
    tiles.forEach((tile, i) => {
      expect(tile.width / tile.height).toBeCloseTo(images[i]!.width / images[i]!.height, 8);
      expect(tile.width).toBeLessThanOrEqual(width);
      expect(tile.height).toBeGreaterThan(0);
      if (tile.height !== height || used + 4 + tile.width > width) {
        expect(used).toBeLessThanOrEqual(width);
        used = 0;
        height = tile.height;
      }
      used += (used ? 4 : 0) + tile.width;
    });
    expect(used).toBeLessThanOrEqual(width);
  });

  it('fills complete rows and leaves partial rows at their preferred height', () => {
    const tiles = justifiedTiles(Array.from({ length: 4 }, () => ({ width: 1, height: 1 })), 604, 200, 4);
    expect(tiles.slice(0, 3).reduce((width, tile) => width + tile.width, 8)).toBeCloseTo(603.5);
    expect(tiles[3]).toEqual({ width: 200, height: 200 });
  });

  it('handles missing dimensions and an empty or unmeasured gallery', () => {
    expect(justifiedTiles([], 320, 120, 4)).toEqual([]);
    expect(justifiedTiles(images, 0, 120, 4)).toEqual([]);
    expect(justifiedTiles([{ width: 0, height: 0 }], 320, 120, 4)[0]).toEqual({ width: 120, height: 120 });
  });
});

import { describe, expect, it } from 'vitest';

import { resolveFeedWindowRange, type FeedWindowGeometry } from './useFeedWindow';

function geometry(overrides: Partial<FeedWindowGeometry> = {}): FeedWindowGeometry {
  return {
    heights: Array.from({ length: 10 }, () => 100),
    gapPx: 20,
    viewportTop: 0,
    viewportHeight: 100,
    overscanScreens: 0,
    minRendered: 1,
    ...overrides
  };
}

/** The column must stay exactly as tall as a fully rendered list, or the scrollbar lies. */
function totalRenderedHeight(input: FeedWindowGeometry) {
  const range = resolveFeedWindowRange(input);
  const rendered = input.heights.slice(range.startIndex, range.endIndex + 1);
  const renderedHeight = rendered.reduce((sum, height) => sum + height, 0) + Math.max(0, rendered.length - 1) * input.gapPx;

  return range.padTopPx + renderedHeight + range.padBottomPx;
}

describe('resolveFeedWindowRange', () => {
  it('renders nothing for an empty feed', () => {
    expect(resolveFeedWindowRange(geometry({ heights: [] }))).toEqual({
      startIndex: 0,
      endIndex: -1,
      padTopPx: 0,
      padBottomPx: 0
    });
  });

  it('keeps only the rows the viewport touches and pads out the rest', () => {
    const input = geometry({ viewportTop: 500 });
    const range = resolveFeedWindowRange(input);

    expect(range.startIndex).toBe(4);
    expect(range.endIndex).toBe(4);
    expect(range.padTopPx).toBe(480);
    expect(range.padBottomPx).toBe(600);
    expect(totalRenderedHeight(input)).toBe(1180);
  });

  it('grows the window by whole viewports of overscan', () => {
    const range = resolveFeedWindowRange(geometry({ viewportTop: 500, viewportHeight: 100, overscanScreens: 2 }));

    expect(range.startIndex).toBe(2);
    expect(range.endIndex).toBe(6);
  });

  it('never renders fewer rows than the floor', () => {
    const input = geometry({ viewportTop: 0, minRendered: 5 });
    const range = resolveFeedWindowRange(input);

    expect(range.endIndex - range.startIndex + 1).toBe(5);
    expect(totalRenderedHeight(input)).toBe(1180);
  });

  it('pulls the floor from the end of the list when the viewport sits at the bottom', () => {
    const input = geometry({ viewportTop: 1080, minRendered: 4 });
    const range = resolveFeedWindowRange(input);

    expect(range.endIndex).toBe(9);
    expect(range.startIndex).toBe(6);
    expect(range.padBottomPx).toBe(0);
    expect(totalRenderedHeight(input)).toBe(1180);
  });

  it('keeps a pinned row mounted even when it scrolled far away', () => {
    const input = geometry({ viewportTop: 1080, pinnedIndex: 0 });
    const range = resolveFeedWindowRange(input);

    expect(range.startIndex).toBe(0);
    expect(range.padTopPx).toBe(0);
    expect(range.endIndex).toBe(9);
    expect(totalRenderedHeight(input)).toBe(1180);
  });

  it('ignores a pinned row that is not part of the list', () => {
    const range = resolveFeedWindowRange(geometry({ viewportTop: 500, pinnedIndex: 99 }));

    expect(range.startIndex).toBe(4);
    expect(range.endIndex).toBe(4);
  });

  it('measures rows against the real gap so estimates and measurements can be mixed', () => {
    const input = geometry({ heights: [300, 900, 120, 640, 700], gapPx: 19.2, viewportTop: 1200, viewportHeight: 800 });

    expect(totalRenderedHeight(input)).toBeCloseTo(2660 + 4 * 19.2, 5);
  });
});

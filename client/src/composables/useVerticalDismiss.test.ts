import { describe, expect, it, vi } from 'vitest';

import { useVerticalDismiss } from './useVerticalDismiss';

function createHarness(axis: 'vertical' | 'horizontal') {
  const onDismiss = vi.fn();
  const dismiss = useVerticalDismiss({
    getAxis: () => axis,
    onDismiss
  });

  const surface = document.createElement('div');

  // jsdom has no PointerEvent constructor, so the handlers get the shape they read.
  function press(clientX = 200, clientY = 300) {
    dismiss.onPointerdown({
      clientX,
      clientY,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'touch',
      currentTarget: surface
    } as unknown as PointerEvent);
  }

  function move(clientX: number, clientY: number) {
    dismiss.onPointermove({ clientX, clientY, pointerId: 1 } as unknown as PointerEvent);
  }

  async function release(clientX: number, clientY: number) {
    await dismiss.onPointerup({ clientX, clientY, pointerId: 1 } as unknown as PointerEvent);
  }

  return { dismiss, onDismiss, press, move, release };
}

describe('useVerticalDismiss', () => {
  it('dismisses on a downward drag when the stage is upright', async () => {
    const harness = createHarness('vertical');

    harness.press(200, 300);
    harness.move(204, 420);
    expect(harness.dismiss.isDragging.value).toBe(true);
    expect(harness.dismiss.dragOffset.value).toBe(120);

    await harness.release(204, 420);
    expect(harness.onDismiss).toHaveBeenCalledWith('down');
  });

  it('reads a leftward drag as "down" once the stage is rotated a quarter turn', async () => {
    const harness = createHarness('horizontal');

    // Rotated, the picture's own down-axis points at the left edge of the screen.
    harness.press(300, 200);
    harness.move(180, 204);
    expect(harness.dismiss.isDragging.value).toBe(true);
    expect(harness.dismiss.dragOffset.value).toBe(120);

    await harness.release(180, 204);
    expect(harness.onDismiss).toHaveBeenCalledWith('down');
  });

  it('ignores a rotated drag that runs along the picture cross-axis', async () => {
    const harness = createHarness('horizontal');

    harness.press(300, 200);
    harness.move(304, 380);

    expect(harness.dismiss.isDragging.value).toBe(false);
    await harness.release(304, 380);
    expect(harness.onDismiss).not.toHaveBeenCalled();
  });
});

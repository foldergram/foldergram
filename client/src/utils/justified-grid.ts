type Dimensions = { width: number; height: number };
type Tile = { width: number; height: number };

// Keep item order and aspect ratios, filling complete rows without stretching
// the unfinished final row. Reserve a small rounding allowance for flex layout.
export function justifiedTiles(items: Dimensions[], width: number, target: number, gap: number): Tile[] {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(target) || target <= 0) return [];
  const tiles: Tile[] = [];
  let row: number[] = [];
  let sum = 0;
  const heightFor = (count: number, total: number) => (Math.max(0.01, width - gap * (count - 1) - 0.5)) / total;
  const finish = (complete: boolean) => {
    if (!row.length) return;
    const availableHeight = heightFor(row.length, sum);
    const height = complete ? availableHeight : Math.min(target, availableHeight);
    for (const ratio of row) tiles.push({ width: ratio * height, height });
    row = [];
    sum = 0;
  };
  for (const item of items) {
    const aspect = item.width / item.height;
    const ratio = item.width > 0 && item.height > 0 && Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    if (row.length && (row.length * gap + 0.5 >= width ||
      (heightFor(row.length + 1, sum + ratio) < target &&
        Math.abs(heightFor(row.length, sum) - target) < Math.abs(heightFor(row.length + 1, sum + ratio) - target)))) {
      finish(true);
    }
    row.push(ratio);
    sum += ratio;
    if (heightFor(row.length, sum) <= target) finish(true);
  }
  finish(false);
  return tiles;
}

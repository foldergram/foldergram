const readers = new Map<string, number>();
const removing = new Set<string>();

export function beginPreviewRead(file: string): (() => void) | undefined {
  if (removing.has(file)) return;
  readers.set(file, (readers.get(file) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const remaining = (readers.get(file) ?? 1) - 1;
    if (remaining) readers.set(file, remaining);
    else readers.delete(file);
  };
}

export function beginPreviewRemoval(file: string): (() => void) | undefined {
  if (readers.has(file) || removing.has(file)) return;
  removing.add(file);
  return () => { removing.delete(file); };
}

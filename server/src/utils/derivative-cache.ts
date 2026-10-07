import fs from 'node:fs/promises';

// Cache reads deliberately avoid probing media. New video previews are probed
// before publication; legacy nonempty corrupt files require forced regeneration.
export async function isNonemptyDerivative(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

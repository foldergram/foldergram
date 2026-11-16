import fs from 'node:fs';

import { isSupportedMediaFile } from './image-utils.js';
import { isHiddenPath } from './path-utils.js';

export function countSupportedRootMediaFiles(galleryRoot: string, includeHeic = false): number {
  try {
    const entries = fs.readdirSync(galleryRoot, { withFileTypes: true });

    return entries.reduce((count, entry) => {
      if (isHiddenPath(entry.name)) {
        return count;
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) {
        return count;
      }

      return isSupportedMediaFile(entry.name, includeHeic) ? count + 1 : count;
    }, 0);
  } catch {
    return 0;
  }
}

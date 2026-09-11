import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/._*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1
  }
});

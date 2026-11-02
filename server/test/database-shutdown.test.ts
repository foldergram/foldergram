import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe.sequential('database shutdown checkpoint', () => {
  let tempRoot = '';

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-database-shutdown-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('reports an incomplete checkpoint when another connection pins the WAL', async () => {
    const databaseDirectory = path.join(tempRoot, 'db');
    await fs.mkdir(databaseDirectory, { recursive: true });
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_DIR', databaseDirectory);
    vi.resetModules();

    const { databaseManager } = await import('../src/db/database.js');
    const databasePath = path.join(databaseDirectory, 'gallery.sqlite');
    const database = databaseManager.connection;
    database.exec(`
      CREATE TABLE checkpoint_probe (value TEXT NOT NULL);
      INSERT INTO checkpoint_probe(value) VALUES ('checkpointed');
      PRAGMA wal_checkpoint(TRUNCATE);
    `);

    const reader = new DatabaseSync(databasePath);
    let mainOnlyCopy: DatabaseSync | null = null;
    let logSpy: ReturnType<typeof vi.spyOn> | null = null;

    try {
      reader.exec('BEGIN');
      reader.prepare('SELECT COUNT(*) AS count FROM checkpoint_probe').get();

      database.prepare('INSERT INTO checkpoint_probe(value) VALUES (?)').run('only-in-wal');

      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const checkpoint = databaseManager.close();

      expect(checkpoint).toMatchObject({
        busy: 1,
        complete: false
      });
      expect(checkpoint?.logFrames).toBeGreaterThan(0);
      expect(checkpoint?.checkpointedFrames).toBe(0);

      const loggedMessages = logSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
      expect(loggedMessages).toContain('SQLite WAL checkpoint incomplete');

      const copyPath = path.join(tempRoot, 'main-only.sqlite');
      await fs.copyFile(databasePath, copyPath);
      mainOnlyCopy = new DatabaseSync(copyPath);
      expect(
        mainOnlyCopy
          .prepare('SELECT COUNT(*) AS count FROM checkpoint_probe WHERE value = ?')
          .get('only-in-wal')
      ).toEqual({ count: 0 });
    } finally {
      mainOnlyCopy?.close();
      reader.exec('ROLLBACK');
      reader.close();
      logSpy?.mockRestore();
    }
  }, 15_000);
});

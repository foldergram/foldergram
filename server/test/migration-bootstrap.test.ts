import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MigrationModule = typeof import('../src/db/migration.js');
type DatabaseModule = typeof import('../src/db/database.js');

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(testDirectory, '..');
const bundledMigrationsDirectory = path.join(serverRoot, 'db', 'migrations', 'sqlite');

function listAppliedVersions(database: DatabaseSync): string[] {
  if (!tableExists(database, 'schema_migrations')) {
    return [];
  }

  return (database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: string }>)
    .map((row) => row.version);
}

function tableExists(database: DatabaseSync, name: string): boolean {
  const row = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { name: string } | undefined;

  return row?.name === name;
}

function tableHasColumn(database: DatabaseSync, tableName: string, columnName: string): boolean {
  if (!tableExists(database, tableName)) {
    return false;
  }

  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function getColumnInfo(database: DatabaseSync, tableName: string, columnName: string): { notnull: number; dflt_value: string | null } | null {
  if (!tableExists(database, tableName)) {
    return null;
  }

  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  const row = rows.find((entry) => entry.name === columnName);
  return row ? { notnull: row.notnull, dflt_value: row.dflt_value } : null;
}

function listForeignKeySignatures(database: DatabaseSync, tableName: string): string[] {
  if (!tableExists(database, tableName)) {
    return [];
  }

  const rows = database.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>;

  return rows
    .map((row) => `${row.from}->${row.table}.${row.to}:${row.on_delete}`)
    .sort();
}

async function createTestMigrationsDirectory(rootDirectory: string, extraMigrations: Array<[filename: string, sql: string]> = []): Promise<string> {
  const targetDirectory = path.join(rootDirectory, 'migrations');
  await fs.mkdir(targetDirectory, { recursive: true });
  const bundledFiles = await fs.readdir(bundledMigrationsDirectory);

  for (const bundledFile of bundledFiles) {
    await fs.copyFile(path.join(bundledMigrationsDirectory, bundledFile), path.join(targetDirectory, bundledFile));
  }

  for (const [filename, sql] of extraMigrations) {
    await fs.writeFile(path.join(targetDirectory, filename), sql);
  }

  return targetDirectory;
}

describe.sequential('dbmate startup migrations', () => {
  let tempRoot = '';

  function stubBaseEnv(): void {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  }

  async function importMigrationModule(): Promise<MigrationModule> {
    return import('../src/db/migration.js');
  }

  async function importDatabaseModule(): Promise<DatabaseModule> {
    return import('../src/db/database.js');
  }

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-migrations-'));
  });

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.doUnmock('../src/db/migration.js');
    vi.doUnmock('../src/services/log-service.js');
    vi.resetModules();
    vi.restoreAllMocks();

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
    stubBaseEnv();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('runs the baseline migration for a fresh database', async () => {
    const { BASELINE_MIGRATION_VERSION, runStartupMigrations } = await importMigrationModule();

    const result = runStartupMigrations();

    expect(result.usedInMemoryDatabase).toBe(false);

    const database = new DatabaseSync(path.join(tempRoot, 'db', 'gallery.sqlite'));

    try {
      expect(tableExists(database, 'folders')).toBe(true);
      expect(tableExists(database, 'images')).toBe(true);
      expect(tableExists(database, 'collections')).toBe(true);
      expect(tableHasColumn(database, 'images', 'caption')).toBe(true);
      expect(listAppliedVersions(database)).toEqual([BASELINE_MIGRATION_VERSION, '000002']);
    } finally {
      database.close();
    }
  });

  it('marks an existing pre-dbmate database as baseline without dropping indexed data', async () => {
    const databasePath = path.join(tempRoot, 'db', 'gallery.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });

    const legacyDatabase = new DatabaseSync(databasePath);

    try {
      legacyDatabase.exec(`
        CREATE TABLE folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          folder_path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          extension TEXT NOT NULL,
          relative_path TEXT NOT NULL UNIQUE,
          absolute_path TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          checksum_or_fingerprint TEXT NOT NULL,
          mtime_ms REAL NOT NULL,
          first_seen_at TEXT NOT NULL,
          sort_timestamp INTEGER NOT NULL,
          thumbnail_path TEXT NOT NULL,
          preview_path TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
        );
      `);

      legacyDatabase
        .prepare('INSERT INTO folders(slug, name, folder_path) VALUES (?, ?, ?)')
        .run('legacy-folder', 'Legacy Folder', 'legacy-folder');
      legacyDatabase.prepare(`
        INSERT INTO images(
          folder_id,
          filename,
          extension,
          relative_path,
          absolute_path,
          file_size,
          width,
          height,
          mime_type,
          checksum_or_fingerprint,
          mtime_ms,
          first_seen_at,
          sort_timestamp,
          thumbnail_path,
          preview_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        1,
        'photo-1.jpg',
        '.jpg',
        'legacy-folder/photo-1.jpg',
        path.join(tempRoot, 'gallery', 'legacy-folder', 'photo-1.jpg'),
        1234,
        1200,
        900,
        'image/jpeg',
        'legacy-folder/photo-1.jpg:1234',
        Date.parse('2026-05-01T10:00:00.000Z'),
        '2026-05-01T10:00:00.000Z',
        Date.parse('2026-05-01T10:00:00.000Z'),
        'legacy-folder/photo-1.webp',
        'legacy-folder/photo-1.webp'
      );
    } finally {
      legacyDatabase.close();
    }

    const { BASELINE_MIGRATION_VERSION, runStartupMigrations } = await importMigrationModule();
    runStartupMigrations({ databasePath });

    const database = new DatabaseSync(databasePath);

    try {
      expect(listAppliedVersions(database)).toEqual([BASELINE_MIGRATION_VERSION, '000002']);
      expect(tableExists(database, 'collections')).toBe(true);
      expect(tableHasColumn(database, 'folders', 'avatar_image_id')).toBe(true);
      expect(tableHasColumn(database, 'folders', 'avatar_source')).toBe(true);
      expect(tableHasColumn(database, 'images', 'playback_strategy')).toBe(true);
      expect(tableHasColumn(database, 'images', 'caption')).toBe(true);
      expect(listForeignKeySignatures(database, 'folders')).toEqual([
        'avatar_image_id->images.id:NO ACTION',
        'story_owner_folder_id->folders.id:SET NULL'
      ]);
      expect(listForeignKeySignatures(database, 'images')).toEqual([
        'folder_id->folders.id:CASCADE',
        'place_id->places.id:SET NULL'
      ]);
      expect(getColumnInfo(database, 'images', 'playback_strategy')).toEqual({
        notnull: 1,
        dflt_value: "'preview'"
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM images').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT playback_strategy AS playbackStrategy FROM images WHERE id = 1').get()).toEqual({
        playbackStrategy: 'preview'
      });
    } finally {
      database.close();
    }
  });

  it('runs a pending migration once and records its version', async () => {
    const { BASELINE_MIGRATION_VERSION, runStartupMigrations } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'gallery.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const migrationsDirectory = await createTestMigrationsDirectory(tempRoot, [
      [
        '000003_add_test_note.sql',
        `-- migrate:up

ALTER TABLE images ADD COLUMN migration_note TEXT NULL;

-- migrate:down

-- Forward-only for test coverage.
`
      ]
    ]);

    runStartupMigrations({
      databasePath,
      migrationsDirectory
    });

    const database = new DatabaseSync(databasePath);

    try {
      expect(tableHasColumn(database, 'images', 'migration_note')).toBe(true);
      expect(listAppliedVersions(database)).toEqual([BASELINE_MIGRATION_VERSION, '000002', '000003']);
    } finally {
      database.close();
    }
  });

  it('baselines an existing pre-dbmate database before applying later migrations', async () => {
    const databasePath = path.join(tempRoot, 'db', 'gallery.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const legacyDatabase = new DatabaseSync(databasePath);

    try {
      legacyDatabase.exec(`
        CREATE TABLE folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          folder_path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          extension TEXT NOT NULL,
          relative_path TEXT NOT NULL UNIQUE,
          absolute_path TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          checksum_or_fingerprint TEXT NOT NULL,
          mtime_ms REAL NOT NULL,
          first_seen_at TEXT NOT NULL,
          sort_timestamp INTEGER NOT NULL,
          thumbnail_path TEXT NOT NULL,
          preview_path TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
        );
      `);

      legacyDatabase
        .prepare('INSERT INTO folders(slug, name, folder_path) VALUES (?, ?, ?)')
        .run('legacy-folder', 'Legacy Folder', 'legacy-folder');
      legacyDatabase.prepare(`
        INSERT INTO images(
          folder_id,
          filename,
          extension,
          relative_path,
          absolute_path,
          file_size,
          width,
          height,
          mime_type,
          checksum_or_fingerprint,
          mtime_ms,
          first_seen_at,
          sort_timestamp,
          thumbnail_path,
          preview_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        1,
        'photo-1.jpg',
        '.jpg',
        'legacy-folder/photo-1.jpg',
        path.join(tempRoot, 'gallery', 'legacy-folder', 'photo-1.jpg'),
        1234,
        1200,
        900,
        'image/jpeg',
        'legacy-folder/photo-1.jpg:1234',
        Date.parse('2026-05-01T10:00:00.000Z'),
        '2026-05-01T10:00:00.000Z',
        Date.parse('2026-05-01T10:00:00.000Z'),
        'legacy-folder/photo-1.webp',
        'legacy-folder/photo-1.webp'
      );
    } finally {
      legacyDatabase.close();
    }

    const { runStartupMigrations } = await importMigrationModule();
    const migrationsDirectory = await createTestMigrationsDirectory(tempRoot, [
      [
        '000003_add_test_note.sql',
        `-- migrate:up

ALTER TABLE images ADD COLUMN migration_note TEXT NULL;

-- migrate:down

-- Forward-only for test coverage.
`
      ]
    ]);

    runStartupMigrations({ databasePath, migrationsDirectory });

    const database = new DatabaseSync(databasePath);

    try {
      expect(listAppliedVersions(database)).toEqual(['000001', '000002', '000003']);
      expect(tableHasColumn(database, 'images', 'migration_note')).toBe(true);
      expect(tableHasColumn(database, 'images', 'caption')).toBe(true);
      expect(database.prepare('SELECT playback_strategy AS playbackStrategy FROM images WHERE id = 1').get()).toEqual({
        playbackStrategy: 'preview'
      });
    } finally {
      database.close();
    }
  });

  it('is idempotent on a second migration run', async () => {
    const { runStartupMigrations } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'gallery.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const migrationsDirectory = await createTestMigrationsDirectory(tempRoot, [
      [
        '000003_add_test_note.sql',
        `-- migrate:up

ALTER TABLE images ADD COLUMN migration_note TEXT NULL;

-- migrate:down

        -- Forward-only for test coverage.
`
      ]
    ]);

    runStartupMigrations({ databasePath, migrationsDirectory });
    runStartupMigrations({ databasePath, migrationsDirectory });

    const database = new DatabaseSync(databasePath);

    try {
      expect(listAppliedVersions(database)).toEqual(['000001', '000002', '000003']);
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 3 });
    } finally {
      database.close();
    }
  });

  it('throws when a pending migration fails', async () => {
    const { runStartupMigrations } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'gallery.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const migrationsDirectory = await createTestMigrationsDirectory(tempRoot, [
      [
        '000003_broken.sql',
        `-- migrate:up

THIS IS NOT VALID SQL;

-- migrate:down

-- Forward-only for test coverage.
`
      ]
    ]);

    expect(() =>
      runStartupMigrations({
        databasePath,
        migrationsDirectory
      })
    ).toThrow(/Dbmate exited with status/i);
  });

  it('exits the migration script when startup migrations fail', async () => {
    const exitError = new Error('process.exit:1');
    const scriptPath = path.join(serverRoot, 'src', 'scripts', 'migrate.ts');
    const originalArgv1 = process.argv[1];
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const logErrorMock = vi.fn();

    try {
      process.argv[1] = scriptPath;

      vi.doMock('../src/db/migration.js', () => ({
        runStartupMigrations: () => {
          throw exitError;
        }
      }));
      vi.doMock('../src/services/log-service.js', () => ({
        log: {
          info: vi.fn(),
          error: logErrorMock,
          table: vi.fn()
        }
      }));

      await expect(import('../src/scripts/migrate.js')).rejects.toThrow('process.exit:1');

      expect(logErrorMock).toHaveBeenCalledWith(
        'Database migration failed. Foldergram will not start until the issue is resolved.',
        'process.exit:1'
      );
    } finally {
      process.argv[1] = originalArgv1;
      processExitSpy.mockRestore();
      vi.doUnmock('../src/db/migration.js');
      vi.doUnmock('../src/services/log-service.js');
      vi.resetModules();
    }
  });

  it('keeps the in-memory fallback when the database directory is unavailable', async () => {
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'occupied-file'));
    await fs.writeFile(path.join(tempRoot, 'occupied-file'), 'not-a-directory');
    vi.resetModules();

    const { runStartupMigrations } = await importMigrationModule();
    const result = runStartupMigrations();

    expect(result.usedInMemoryDatabase).toBe(true);
    expect(result.databasePath).toBe(':memory:');

    const { databaseManager } = await importDatabaseModule();
    const driver = await databaseManager.getConnection();
    const { rows } = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'folders'"
    );
    expect(rows[0]?.name).toBe('folders');
  });
});

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
const bundledMigrationsDirectory = path.join(serverRoot, 'db', 'migrations');

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
      expect(tableExists(database, 'posts')).toBe(true);
      expect(tableExists(database, 'post_items')).toBe(true);
      expect(tableExists(database, 'collections')).toBe(true);
      expect(tableHasColumn(database, 'images', 'caption')).toBe(true);
      expect(tableHasColumn(database, 'likes', 'post_id')).toBe(true);
      expect(tableHasColumn(database, 'collection_items', 'post_id')).toBe(true);
      expect(tableHasColumn(database, 'scan_runs', 'warning_count')).toBe(true);
      expect(tableHasColumn(database, 'scan_runs', 'warning_text')).toBe(true);
      expect(listAppliedVersions(database)).toEqual([BASELINE_MIGRATION_VERSION, '000002', '000004', '000005', '000006']);
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
      expect(listAppliedVersions(database)).toEqual([BASELINE_MIGRATION_VERSION, '000002', '000004', '000005', '000006']);
      expect(tableExists(database, 'collections')).toBe(true);
      expect(tableHasColumn(database, 'folders', 'avatar_image_id')).toBe(true);
      expect(tableHasColumn(database, 'folders', 'avatar_source')).toBe(true);
      expect(tableHasColumn(database, 'images', 'playback_strategy')).toBe(true);
      expect(tableHasColumn(database, 'images', 'caption')).toBe(true);
      expect(tableExists(database, 'folder_share_links')).toBe(true);
      expect(tableExists(database, 'folder_share_passwords')).toBe(true);
      expect(tableHasColumn(database, 'folders', 'share_password_version')).toBe(true);
      expect(tableExists(database, 'posts')).toBe(true);
      expect(tableExists(database, 'post_items')).toBe(true);
      expect(tableHasColumn(database, 'collection_items', 'post_id')).toBe(true);
      expect(database.prepare('SELECT COUNT(*) AS count FROM posts').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM post_items').get()).toEqual({ count: 1 });
      expect(listForeignKeySignatures(database, 'folders')).toEqual([
        'avatar_image_id->images.id:NO ACTION',
        'carousel_owner_folder_id->folders.id:SET NULL',
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

  it('recognizes complete pre-dbmate folder-sharing schema without rerunning 000004', async () => {
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
          share_password_version INTEGER NOT NULL DEFAULT 0,
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

        CREATE TABLE folder_share_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          token_prefix TEXT NULL,
          expires_at TEXT NULL,
          revoked_at TEXT NULL,
          allow_original_downloads INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_used_at TEXT NULL,
          FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
        );

        CREATE TABLE folder_share_passwords (
          folder_id INTEGER PRIMARY KEY,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
        );
      `);
    } finally {
      legacyDatabase.close();
    }

    const { runStartupMigrations } = await importMigrationModule();
    runStartupMigrations({ databasePath });

    const database = new DatabaseSync(databasePath);
    try {
      expect(tableExists(database, 'folder_share_links')).toBe(true);
      expect(tableExists(database, 'folder_share_passwords')).toBe(true);
      expect(tableHasColumn(database, 'folders', 'share_password_version')).toBe(true);
      expect(listAppliedVersions(database)).toEqual(['000001', '000002', '000004', '000005', '000006']);
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
      expect(listAppliedVersions(database)).toEqual([BASELINE_MIGRATION_VERSION, '000002', '000003', '000004', '000005', '000006']);
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
        '000007_add_test_note.sql',
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
      expect(listAppliedVersions(database)).toEqual(['000001', '000002', '000004', '000005', '000006', '000007']);
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
      expect(listAppliedVersions(database)).toEqual(['000001', '000002', '000003', '000004', '000005', '000006']);
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({ count: 6 });
    } finally {
      database.close();
    }
  });

  it('repairs a falsely recorded 000004 migration when all folder-sharing schema is absent', async () => {
    const { runStartupMigrations } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'gallery.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });

    runStartupMigrations({ databasePath });

    const brokenDatabase = new DatabaseSync(databasePath);
    try {
      brokenDatabase.exec(`
        DROP TABLE folder_share_passwords;
        DROP TABLE folder_share_links;
        ALTER TABLE folders DROP COLUMN share_password_version;
      `);
    } finally {
      brokenDatabase.close();
    }

    runStartupMigrations({ databasePath });

    const repairedDatabase = new DatabaseSync(databasePath);
    try {
      expect(tableExists(repairedDatabase, 'folder_share_links')).toBe(true);
      expect(tableExists(repairedDatabase, 'folder_share_passwords')).toBe(true);
      expect(tableHasColumn(repairedDatabase, 'folders', 'share_password_version')).toBe(true);
      expect(listAppliedVersions(repairedDatabase)).toEqual(['000001', '000002', '000004', '000005', '000006']);
    } finally {
      repairedDatabase.close();
    }
  });

  it('resumes 000005 when an interrupted run recorded only additive columns', async () => {
    const { runStartupMigrations } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'gallery.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const throughFolderSharesMigrations = await createTestMigrationsDirectory(path.join(tempRoot, 'through-folder-shares'));
    await fs.rm(path.join(throughFolderSharesMigrations, '000005_add_posts_and_carousels.sql'));

    runStartupMigrations({
      databasePath,
      migrationsDirectory: throughFolderSharesMigrations
    });

    const interruptedDatabase = new DatabaseSync(databasePath);
    try {
      interruptedDatabase.exec(`
        ALTER TABLE folders ADD COLUMN carousel_owner_folder_id INTEGER NULL REFERENCES folders(id) ON DELETE SET NULL;
        ALTER TABLE scan_runs ADD COLUMN warning_count INTEGER NOT NULL DEFAULT 0;
      `);
      interruptedDatabase.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run('000005');
    } finally {
      interruptedDatabase.close();
    }

    runStartupMigrations({ databasePath });

    const repairedDatabase = new DatabaseSync(databasePath);
    try {
      expect(tableExists(repairedDatabase, 'posts')).toBe(true);
      expect(tableExists(repairedDatabase, 'post_items')).toBe(true);
      expect(tableHasColumn(repairedDatabase, 'likes', 'post_id')).toBe(true);
      expect(tableHasColumn(repairedDatabase, 'collection_items', 'post_id')).toBe(true);
      expect(tableHasColumn(repairedDatabase, 'folders', 'carousel_owner_folder_id')).toBe(true);
      expect(tableHasColumn(repairedDatabase, 'scan_runs', 'warning_count')).toBe(true);
      expect(tableHasColumn(repairedDatabase, 'scan_runs', 'warning_text')).toBe(true);
      expect(listAppliedVersions(repairedDatabase)).toEqual(['000001', '000002', '000004', '000005', '000006']);
    } finally {
      repairedDatabase.close();
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
    expect(tableExists(databaseManager.connection, 'folders')).toBe(true);
  });

  it('adds share_password_version to folders and creates folder_share_passwords in consolidated 000004 migration', async () => {
    const { runStartupMigrations } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'gallery.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });

    runStartupMigrations({ databasePath });

    const database = new DatabaseSync(databasePath);

    try {
      expect(tableHasColumn(database, 'folders', 'share_password_version')).toBe(true);

      const columnInfo = getColumnInfo(database, 'folders', 'share_password_version');
      expect(columnInfo).not.toBeNull();
      expect(columnInfo?.notnull).toBe(1);
      expect(columnInfo?.dflt_value).toBe('0');

      database
        .prepare('INSERT INTO folders(slug, name, folder_path) VALUES (?, ?, ?)')
        .run('test-folder', 'Test Folder', 'test-folder');

      const inserted = database
        .prepare('SELECT share_password_version FROM folders WHERE slug = ?')
        .get('test-folder') as { share_password_version: number };

      expect(inserted.share_password_version).toBe(0);
      expect(tableExists(database, 'folder_share_passwords')).toBe(true);
    } finally {
      database.close();
    }
  });

  it('rejects superficially complete migration 000005 when indexes or invariants are missing', async () => {
    const { runStartupMigrations, validatePostsMigrationCompleteness } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'corrupt.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });

    runStartupMigrations({ databasePath });

    const database = new DatabaseSync(databasePath);

    try {
      // Drop index to simulate corruption
      database.exec('DROP INDEX IF EXISTS idx_posts_folder_visible_sort');
      expect(() => validatePostsMigrationCompleteness(database)).toThrow('missing required index idx_posts_folder_visible_sort');
    } finally {
      database.close();
    }
  });

  it('rejects a required index with the right name but wrong uniqueness or column order', async () => {
    const { runStartupMigrations, validatePostsMigrationCompleteness } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'wrong-index.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    runStartupMigrations({ databasePath });

    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`
        DROP INDEX idx_post_items_image_id;
        CREATE INDEX idx_post_items_image_id ON post_items(post_id, image_id);
      `);
      expect(() => validatePostsMigrationCompleteness(database)).toThrow(
        'index idx_post_items_image_id has an incorrect uniqueness or column order'
      );
    } finally {
      database.close();
    }
  });

  it('allows harmless additive columns after migration 000005', async () => {
    const { runStartupMigrations, validatePostsMigrationCompleteness } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'future-column.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    runStartupMigrations({ databasePath });

    const database = new DatabaseSync(databasePath);
    try {
      database.exec('ALTER TABLE posts ADD COLUMN future_note TEXT NULL');
      expect(() => validatePostsMigrationCompleteness(database)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it('preserves all convertible posts, likes, collection memberships, IDs, and timestamps in migration 000005', async () => {
    const { runStartupMigrations, validatePostsMigrationCompleteness } = await importMigrationModule();
    const databasePath = path.join(tempRoot, 'db', 'rich-legacy.sqlite');
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const throughFolderSharesMigrations = await createTestMigrationsDirectory(path.join(tempRoot, 'through-folder-shares'));
    await fs.rm(path.join(throughFolderSharesMigrations, '000005_add_posts_and_carousels.sql'));
    runStartupMigrations({ databasePath, migrationsDirectory: throughFolderSharesMigrations });

    const legacyDatabase = new DatabaseSync(databasePath);
    try {
      legacyDatabase.exec(`
        INSERT INTO folders(id, slug, name, folder_path, role) VALUES
          (1, 'album', 'Album', 'album', 'normal'),
          (2, 'stories', 'Stories', 'album/stories', 'story_capsule');

        INSERT INTO images(
          id, folder_id, filename, extension, relative_path, absolute_path, file_size, width, height,
          mime_type, checksum_or_fingerprint, mtime_ms, first_seen_at, sort_timestamp, caption,
          thumbnail_path, preview_path, created_at, updated_at
        ) VALUES
          (1, 1, 'one.jpg', '.jpg', 'album/one.jpg', 'temp/album/one.jpg', 101, 1000, 800,
           'image/jpeg', 'fp-1', 1001, '2026-01-01T00:00:00.000Z', 1001, 'One',
           'album/one.webp', 'album/one.webp', '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:02.000Z'),
          (2, 1, 'two.jpg', '.jpg', 'album/two.jpg', 'temp/album/two.jpg', 102, 1000, 800,
           'image/jpeg', 'fp-2', 1002, '2026-01-02T00:00:00.000Z', 1002, 'Two',
           'album/two.webp', 'album/two.webp', '2026-01-02T00:00:01.000Z', '2026-01-02T00:00:02.000Z'),
          (3, 1, 'cover.jpg', '.jpg', 'album/cover.jpg', 'temp/album/cover.jpg', 103, 1000, 800,
           'image/jpeg', 'fp-3', 1003, '2026-01-03T00:00:00.000Z', 1003, NULL,
           'album/cover.webp', 'album/cover.webp', '2026-01-03T00:00:01.000Z', '2026-01-03T00:00:02.000Z'),
          (4, 2, 'story.jpg', '.jpg', 'album/stories/story.jpg', 'temp/album/stories/story.jpg', 104, 1000, 800,
           'image/jpeg', 'fp-4', 1004, '2026-01-04T00:00:00.000Z', 1004, NULL,
           'album/stories/story.webp', 'album/stories/story.webp', '2026-01-04T00:00:01.000Z', '2026-01-04T00:00:02.000Z');

        INSERT INTO likes(image_id, created_at) VALUES
          (1, '2026-02-01T00:00:00.000Z'),
          (2, '2026-02-02T00:00:00.000Z'),
          (3, '2026-02-03T00:00:00.000Z');
        INSERT INTO collections(id, slug, name, is_default) VALUES
          (1, 'saved', 'Saved', 1),
          (2, 'trip', 'Trip', 0);
        INSERT INTO collection_items(collection_id, image_id, created_at) VALUES
          (1, 1, '2026-03-01T00:00:00.000Z'),
          (2, 1, '2026-03-02T00:00:00.000Z'),
          (2, 2, '2026-03-03T00:00:00.000Z'),
          (2, 3, '2026-03-04T00:00:00.000Z');
      `);
    } finally {
      legacyDatabase.close();
    }

    runStartupMigrations({ databasePath });
    const database = new DatabaseSync(databasePath);
    try {
      expect(database.prepare('SELECT id, caption, created_at, updated_at FROM posts ORDER BY id').all()).toEqual([
        { id: 1, caption: 'One', created_at: '2026-01-01T00:00:01.000Z', updated_at: '2026-01-01T00:00:02.000Z' },
        { id: 2, caption: 'Two', created_at: '2026-01-02T00:00:01.000Z', updated_at: '2026-01-02T00:00:02.000Z' }
      ]);
      expect(database.prepare('SELECT post_id, image_id, position FROM post_items ORDER BY post_id').all()).toEqual([
        { post_id: 1, image_id: 1, position: 1 },
        { post_id: 2, image_id: 2, position: 1 }
      ]);
      expect(database.prepare('SELECT post_id, created_at FROM likes ORDER BY post_id').all()).toEqual([
        { post_id: 1, created_at: '2026-02-01T00:00:00.000Z' },
        { post_id: 2, created_at: '2026-02-02T00:00:00.000Z' }
      ]);
      expect(database.prepare('SELECT collection_id, post_id, created_at FROM collection_items ORDER BY collection_id, post_id').all()).toEqual([
        { collection_id: 1, post_id: 1, created_at: '2026-03-01T00:00:00.000Z' },
        { collection_id: 2, post_id: 1, created_at: '2026-03-02T00:00:00.000Z' },
        { collection_id: 2, post_id: 2, created_at: '2026-03-03T00:00:00.000Z' }
      ]);
      expect(() => validatePostsMigrationCompleteness(database)).not.toThrow();

      database.prepare('DELETE FROM post_items WHERE post_id = 2').run();
      expect(() => validatePostsMigrationCompleteness(database)).toThrow('lack a representative position 1 item');
    } finally {
      database.close();
    }
  });
});

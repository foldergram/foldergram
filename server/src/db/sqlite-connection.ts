import { DatabaseSync } from 'node:sqlite';

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

export interface SqliteConnectionPolicy {
  fileBacked: boolean;
  foreignKeys: boolean;
  busyTimeoutMs: number;
  journalMode: string;
  synchronous: number;
}

export interface OpenSqliteDatabaseOptions {
  busyTimeoutMs?: number;
  onConfigured?: (policy: SqliteConnectionPolicy) => void;
}

interface ForeignKeysPragmaRow {
  foreign_keys?: number;
}

interface BusyTimeoutPragmaRow {
  timeout?: number;
}

interface JournalModePragmaRow {
  journal_mode?: string;
}

interface SynchronousPragmaRow {
  synchronous?: number;
}

interface WalCheckpointPragmaRow {
  busy?: number;
  log?: number;
  checkpointed?: number;
}

export interface SqliteWalCheckpointResult {
  busy: number;
  logFrames: number;
  checkpointedFrames: number;
  complete: boolean;
}

function readJournalMode(database: DatabaseSync): string {
  const row = database.prepare('PRAGMA journal_mode').get() as JournalModePragmaRow | undefined;
  return (row?.journal_mode ?? 'unknown').toLowerCase();
}

export function checkpointSqliteWal(database: DatabaseSync): SqliteWalCheckpointResult | null {
  if (readJournalMode(database) !== 'wal') {
    return null;
  }

  const row = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as WalCheckpointPragmaRow | undefined;
  const busy = row?.busy ?? 0;
  const logFrames = row?.log ?? 0;
  const checkpointedFrames = row?.checkpointed ?? 0;

  return {
    busy,
    logFrames,
    checkpointedFrames,
    complete: busy === 0 && checkpointedFrames === logFrames
  };
}

export function configureSqliteConnection(
  database: DatabaseSync,
  options: { fileBacked: boolean; busyTimeoutMs?: number }
): SqliteConnectionPolicy {
  const busyTimeoutMs = Math.max(0, Math.trunc(options.busyTimeoutMs ?? SQLITE_BUSY_TIMEOUT_MS));
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);

  let journalMode: string;
  if (options.fileBacked) {
    const row = database.prepare('PRAGMA journal_mode = WAL').get() as JournalModePragmaRow | undefined;
    journalMode = (row?.journal_mode ?? readJournalMode(database)).toLowerCase();
    if (journalMode === 'wal') {
      database.exec('PRAGMA synchronous = NORMAL');
    }
  } else {
    journalMode = readJournalMode(database);
  }

  const foreignKeysRow = database.prepare('PRAGMA foreign_keys').get() as ForeignKeysPragmaRow | undefined;
  const busyTimeoutRow = database.prepare('PRAGMA busy_timeout').get() as BusyTimeoutPragmaRow | undefined;
  const synchronousRow = database.prepare('PRAGMA synchronous').get() as SynchronousPragmaRow | undefined;

  return {
    fileBacked: options.fileBacked,
    foreignKeys: foreignKeysRow?.foreign_keys === 1,
    busyTimeoutMs: busyTimeoutRow?.timeout ?? busyTimeoutMs,
    journalMode,
    synchronous: synchronousRow?.synchronous ?? 0
  };
}

export function openSqliteDatabase(
  databasePath: string,
  options: OpenSqliteDatabaseOptions = {}
): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  try {
    // Configure the shared connection policy before any schema access,
    // including on short-lived connections used during startup checks.
    const policy = configureSqliteConnection(database, {
      fileBacked: databasePath !== ':memory:',
      busyTimeoutMs: options.busyTimeoutMs
    });
    options.onConfigured?.(policy);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

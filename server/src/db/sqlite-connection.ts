import { DatabaseSync } from 'node:sqlite';

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

export function openSqliteDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  try {
    // Configure contention handling before any schema access, including on
    // short-lived connections used during cold-start migration checks.
    database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

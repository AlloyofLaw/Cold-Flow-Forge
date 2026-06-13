// ---------------------------------------------------------------------------
// SQLite database connection + schema bootstrap.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config";
import { SCHEMA_SQL } from "./schema";

let db: Database.Database | undefined;

/**
 * Open (or return the existing) SQLite connection, creating the schema on
 * first use. Pass an explicit `dbPath` to override the configured path
 * (used by tests, e.g. `:memory:`).
 */
export function getDb(dbPath: string = config.dbPath): Database.Database {
  if (db) return db;

  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}

/** Close the current database connection (used by tests / shutdown). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

/**
 * Reset the cached connection so the next `getDb()` call opens a fresh one.
 * Useful for tests that want an isolated in-memory database per test.
 */
export function resetDb(): void {
  closeDb();
}

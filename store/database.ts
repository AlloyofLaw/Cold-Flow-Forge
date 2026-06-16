// ---------------------------------------------------------------------------
// SQLite database connection + schema bootstrap.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { config } from "../config";
import { SCHEMA_SQL } from "./schema";

// ---------------------------------------------------------------------------
// Thin adapter so the rest of the store never touches node:sqlite directly.
// ---------------------------------------------------------------------------

class JarvisDatabase {
  readonly raw: DatabaseSync;

  constructor(dbPath: string) {
    this.raw = new DatabaseSync(dbPath);
  }

  prepare(sql: string): StatementSync {
    const stmt = this.raw.prepare(sql);
    stmt.setAllowBareNamedParameters(true);
    return stmt;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  pragma(p: string): void {
    this.raw.exec(`PRAGMA ${p};`);
  }

  close(): void {
    this.raw.close();
  }
}

export type Database = JarvisDatabase;
export { JarvisDatabase };

// ---------------------------------------------------------------------------
// Singleton connection management.
// ---------------------------------------------------------------------------

let db: JarvisDatabase | undefined;

/**
 * Open (or return the existing) SQLite connection, creating the schema on
 * first use. Pass an explicit `dbPath` to override the configured path
 * (used by tests, e.g. `:memory:`).
 */
export function getDb(dbPath: string = config.dbPath): Database {
  if (db) return db;

  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new JarvisDatabase(dbPath);
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

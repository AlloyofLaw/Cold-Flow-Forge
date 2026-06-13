// ---------------------------------------------------------------------------
// Settings access (PRD Section 12: settings table) - simple key/value store.
// ---------------------------------------------------------------------------

import type { Database } from "better-sqlite3";
import { getDb } from "./database";

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

/** Get a raw string setting value, or `undefined` if unset. */
export function getSetting(key: string, database: Database = getDb()): string | undefined {
  const row = database.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | Pick<SettingRow, "value">
    | undefined;
  return row?.value;
}

/** Set a raw string setting value (creates or updates). */
export function setSetting(key: string, value: string, database: Database = getDb()): void {
  database
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value);
}

/** Get a setting as a parsed JSON value, or `undefined` if unset/invalid. */
export function getSettingJson<T>(key: string, database: Database = getDb()): T | undefined {
  const raw = getSetting(key, database);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Set a setting as a JSON-serialized value. */
export function setSettingJson(key: string, value: unknown, database: Database = getDb()): void {
  setSetting(key, JSON.stringify(value), database);
}

/** List all settings as a plain key/value map. */
export function getAllSettings(database: Database = getDb()): Record<string, string> {
  const rows = database.prepare(`SELECT key, value FROM settings`).all() as SettingRow[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

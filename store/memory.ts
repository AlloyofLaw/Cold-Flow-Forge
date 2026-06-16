// ---------------------------------------------------------------------------
// Long-term memory access (PRD FR-2.2): editable/erasable key-value facts.
// ---------------------------------------------------------------------------

import type { Database } from "./database";
import { getDb } from "./database";

export interface MemoryEntry {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

interface MemoryRow {
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    key: row.key,
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Create or update a memory entry. */
export function setMemory(key: string, value: string, database: Database = getDb()): void {
  database
    .prepare(
      `INSERT INTO memory (key, value, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value);
}

/** Fetch a single memory entry, or undefined if it doesn't exist. */
export function getMemory(key: string, database: Database = getDb()): MemoryEntry | undefined {
  const row = database.prepare(`SELECT * FROM memory WHERE key = ?`).get(key) as
    | MemoryRow
    | undefined;
  return row ? rowToEntry(row) : undefined;
}

/** List all memory entries, most recently updated first. */
export function listMemory(database: Database = getDb()): MemoryEntry[] {
  const rows = database
    .prepare(`SELECT * FROM memory ORDER BY updated_at DESC`)
    .all() as unknown as MemoryRow[];
  return rows.map(rowToEntry);
}

/** Delete a memory entry. Returns true if a row was removed. */
export function deleteMemory(key: string, database: Database = getDb()): boolean {
  const info = database.prepare(`DELETE FROM memory WHERE key = ?`).run(key);
  return info.changes > 0;
}

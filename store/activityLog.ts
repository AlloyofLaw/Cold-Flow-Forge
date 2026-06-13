// ---------------------------------------------------------------------------
// Activity log access (append-only audit trail, PRD FR-2.6 / SEC-5).
// ---------------------------------------------------------------------------

import type { Database } from "better-sqlite3";
import { getDb } from "./database";
import type { PermissionTier } from "../core/permissions";

export type ActivityOutcome = "success" | "error" | "denied" | "pending";

export interface ActivityLogEntry {
  id: number;
  createdAt: string;
  skill: string;
  tool: string;
  tier: PermissionTier;
  params: unknown;
  result: unknown;
  outcome: ActivityOutcome;
  summary: string | null;
}

export interface ActivityLogRecordInput {
  skill: string;
  tool: string;
  tier: PermissionTier;
  params?: unknown;
  result?: unknown;
  outcome: ActivityOutcome;
  summary?: string;
}

interface ActivityLogRow {
  id: number;
  created_at: string;
  skill: string;
  tool: string;
  tier: number;
  params_json: string;
  result_json: string | null;
  outcome: ActivityOutcome;
  summary: string | null;
}

function rowToEntry(row: ActivityLogRow): ActivityLogEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    skill: row.skill,
    tool: row.tool,
    tier: row.tier as PermissionTier,
    params: JSON.parse(row.params_json),
    result: row.result_json ? JSON.parse(row.result_json) : null,
    outcome: row.outcome,
    summary: row.summary,
  };
}

/** Append a new entry to the activity log. Returns the inserted row id. */
export function recordActivity(entry: ActivityLogRecordInput, database: Database = getDb()): number {
  const stmt = database.prepare(
    `INSERT INTO activity_log (skill, tool, tier, params_json, result_json, outcome, summary)
     VALUES (@skill, @tool, @tier, @params_json, @result_json, @outcome, @summary)`,
  );

  const info = stmt.run({
    skill: entry.skill,
    tool: entry.tool,
    tier: entry.tier,
    params_json: JSON.stringify(entry.params ?? {}),
    result_json: entry.result === undefined ? null : JSON.stringify(entry.result),
    outcome: entry.outcome,
    summary: entry.summary ?? null,
  });

  return Number(info.lastInsertRowid);
}

/** Fetch the most recent activity log entries, newest first. */
export function listRecentActivity(limit = 50, database: Database = getDb()): ActivityLogEntry[] {
  const rows = database
    .prepare(`SELECT * FROM activity_log ORDER BY id DESC LIMIT ?`)
    .all(limit) as ActivityLogRow[];

  return rows.map(rowToEntry);
}

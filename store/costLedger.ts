// ---------------------------------------------------------------------------
// Cost ledger access (PRD FR-2.8 / FR-8.1 / FR-8.2): per-call usage + cost.
// ---------------------------------------------------------------------------

import type { Database } from "better-sqlite3";
import { getDb } from "./database";

export interface CostEntryInput {
  provider: string;
  model: string;
  inputUnits: number;
  outputUnits: number;
  unitKind?: string;
  estimatedCostUsd: number;
}

export interface CostEntry extends CostEntryInput {
  id: number;
  createdAt: string;
  unitKind: string;
}

interface CostRow {
  id: number;
  created_at: string;
  provider: string;
  model: string;
  input_units: number;
  output_units: number;
  unit_kind: string;
  estimated_cost_usd: number;
}

function rowToEntry(row: CostRow): CostEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    provider: row.provider,
    model: row.model,
    inputUnits: row.input_units,
    outputUnits: row.output_units,
    unitKind: row.unit_kind,
    estimatedCostUsd: row.estimated_cost_usd,
  };
}

/** Record a single LLM/voice API call's usage and estimated cost. */
export function recordCost(entry: CostEntryInput, database: Database = getDb()): number {
  const stmt = database.prepare(
    `INSERT INTO cost_ledger (provider, model, input_units, output_units, unit_kind, estimated_cost_usd)
     VALUES (@provider, @model, @input_units, @output_units, @unit_kind, @estimated_cost_usd)`,
  );

  const info = stmt.run({
    provider: entry.provider,
    model: entry.model,
    input_units: entry.inputUnits,
    output_units: entry.outputUnits,
    unit_kind: entry.unitKind ?? "tokens",
    estimated_cost_usd: entry.estimatedCostUsd,
  });

  return Number(info.lastInsertRowid);
}

/** Sum of estimated costs for entries created on/after `sinceIso`. */
export function getTotalCostSince(sinceIso: string, database: Database = getDb()): number {
  const row = database
    .prepare(`SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM cost_ledger WHERE created_at >= ?`)
    .get(sinceIso) as { total: number };
  return row.total;
}

/** Sum of estimated costs for the current calendar month (UTC). */
export function getCurrentMonthCost(database: Database = getDb()): number {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return getTotalCostSince(startOfMonth, database);
}

/** Sum of estimated costs for today (UTC). */
export function getTodayCost(database: Database = getDb()): number {
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  return getTotalCostSince(startOfDay, database);
}

/** List the most recent cost ledger entries, newest first. */
export function listRecentCosts(limit = 50, database: Database = getDb()): CostEntry[] {
  const rows = database
    .prepare(`SELECT * FROM cost_ledger ORDER BY id DESC LIMIT ?`)
    .all(limit) as CostRow[];
  return rows.map(rowToEntry);
}

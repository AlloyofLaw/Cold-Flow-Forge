// ---------------------------------------------------------------------------
// Cost ledger access (PRD FR-2.8 / FR-8.1 / FR-8.2): per-call usage + cost.
// ---------------------------------------------------------------------------

import type { Database } from "./database";
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
    .get(sinceIso) as unknown as { total: number };
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
    .all(limit) as unknown as CostRow[];
  return rows.map(rowToEntry);
}

// ---------------------------------------------------------------------------
// Budget cap (FR-8.3): "approaching" (>= 80% of the monthly cap) and
// "exceeded" (>= 100%) states, computed from the current month's total cost
// vs. the configured monthly budget.
// ---------------------------------------------------------------------------

/** Fraction of the monthly budget at which JARVIS shows an "approaching cap" warning (FR-8.3). */
export const BUDGET_WARNING_THRESHOLD = 0.8;

export type BudgetState = "ok" | "approaching" | "exceeded";

export interface BudgetStatus {
  /** Total estimated cost for the current calendar month (UTC), in USD. */
  monthCostUsd: number;
  /** The configured monthly budget cap, in USD. */
  monthlyBudgetUsd: number;
  /** `monthCostUsd / monthlyBudgetUsd`, or 0 if the cap is <= 0. */
  fractionUsed: number;
  /**
   * - "ok": below the 80% warning threshold.
   * - "approaching": at/above 80% but below 100% of the cap (FR-8.3 warning).
   * - "exceeded": at/above 100% of the cap - restricted mode (FR-8.3).
   */
  state: BudgetState;
}

/**
 * Compute the current month's cost vs. the configured monthly budget cap
 * (FR-8.2/FR-8.3). A `monthlyBudgetUsd <= 0` is treated as "no cap" (always
 * "ok") rather than dividing by zero / immediately exceeding.
 */
export function getBudgetStatus(monthlyBudgetUsd: number, database: Database = getDb()): BudgetStatus {
  const monthCostUsd = getCurrentMonthCost(database);

  if (monthlyBudgetUsd <= 0) {
    return { monthCostUsd, monthlyBudgetUsd, fractionUsed: 0, state: "ok" };
  }

  const fractionUsed = monthCostUsd / monthlyBudgetUsd;
  let state: BudgetState = "ok";
  if (fractionUsed >= 1) state = "exceeded";
  else if (fractionUsed >= BUDGET_WARNING_THRESHOLD) state = "approaching";

  return { monthCostUsd, monthlyBudgetUsd, fractionUsed, state };
}

// ---------------------------------------------------------------------------
// Permission-tier framework (PRD Section 8).
//
// Every action JARVIS can take falls into one of four tiers. The Brain (not
// the model, and not the skill) is responsible for classifying a tool call
// into a tier and enforcing the corresponding confirmation rule BEFORE the
// call is made (R-6). Phase 0 only exercises Tier 0 (read-only), but the
// full tier model and the confirmation seam are present so later phases can
// plug straight in.
// ---------------------------------------------------------------------------

/**
 * Tier 0 - Read-only: no confirmation needed.
 * Tier 1 - Reversible & internal: no confirmation by default (configurable).
 * Tier 2 - External-facing or hard to reverse: confirmation required.
 * Tier 3 - Financial, destructive, or irreversible: confirmation + read-back
 *          required, and can NEVER be set to auto-approve (R-1).
 */
export const PermissionTier = {
  ReadOnly: 0,
  ReversibleInternal: 1,
  ExternalOrHardToReverse: 2,
  FinancialOrIrreversible: 3,
} as const;

export type PermissionTier = (typeof PermissionTier)[keyof typeof PermissionTier];

export const ALL_TIERS: readonly PermissionTier[] = [
  PermissionTier.ReadOnly,
  PermissionTier.ReversibleInternal,
  PermissionTier.ExternalOrHardToReverse,
  PermissionTier.FinancialOrIrreversible,
];

/** Human-readable label for a tier, used in UI and logs. */
export function tierLabel(tier: PermissionTier): string {
  switch (tier) {
    case PermissionTier.ReadOnly:
      return "Read-only";
    case PermissionTier.ReversibleInternal:
      return "Reversible & internal";
    case PermissionTier.ExternalOrHardToReverse:
      return "External-facing / hard to reverse";
    case PermissionTier.FinancialOrIrreversible:
      return "Financial, destructive, or irreversible";
    default:
      return "Unknown";
  }
}

/**
 * R-1: Tier 3 actions can never be auto-approved. This is hardcoded, not a
 * setting - callers must not provide a way to bypass it.
 */
export function requiresConfirmation(tier: PermissionTier, autoApproveTier1And2 = false): boolean {
  if (tier === PermissionTier.FinancialOrIrreversible) return true;
  if (tier === PermissionTier.ExternalOrHardToReverse) return !autoApproveTier1And2 || true; // Tier 2 always requires confirmation per PRD table.
  if (tier === PermissionTier.ReversibleInternal) return false; // No confirmation by default (configurable later).
  return false; // Tier 0: never requires confirmation.
}

/**
 * Identifies a single tool exposed by a skill (an MCP server in later
 * phases). Used as the key for tier assignment.
 */
export interface ToolIdentifier {
  skill: string;
  tool: string;
}

/** A tier-assignment table: skill -> tool -> tier. */
export type TierAssignments = Record<string, Record<string, PermissionTier>>;

/**
 * R-5 / FR-7.1: unknown tools default to the most restrictive tier
 * (Tier 3) until explicitly classified.
 */
export const DEFAULT_UNKNOWN_TIER: PermissionTier = PermissionTier.FinancialOrIrreversible;

/**
 * Classify a tool call into a permission tier using the supplied
 * assignment table, falling back to DEFAULT_UNKNOWN_TIER for anything not
 * explicitly listed (R-5, R-6, FR-7.1).
 */
export function classifyTool(
  { skill, tool }: ToolIdentifier,
  assignments: TierAssignments,
): PermissionTier {
  return assignments[skill]?.[tool] ?? DEFAULT_UNKNOWN_TIER;
}

/**
 * Phase 0 has no real skills yet, so the registry is empty - everything
 * would fall back to DEFAULT_UNKNOWN_TIER. This constant documents the
 * Phase 0 acceptance criterion ("classifies a dummy action as Tier 0") by
 * giving a name to the tier a trivial, side-effect-free action should be
 * assigned once a real assignment table exists.
 */
export const PHASE0_DUMMY_ACTION: ToolIdentifier = { skill: "core", tool: "ping" };

export const PHASE0_TIER_ASSIGNMENTS: TierAssignments = {
  core: {
    ping: PermissionTier.ReadOnly,
  },
};

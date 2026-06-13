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

/**
 * Tier assignments for every tool exposed by every registered skill
 * (FR-7.1). This is the table `classifyTool` consults from the tool-use
 * loop (core/agent.ts) before any tool actually executes.
 *
 * Phase 1 adds the Google Calendar skill's two read-only tools, both Tier 0
 * per PRD Section 6.3 (FR-3.2) - listing events/calendars never changes
 * anything. Anything not listed here (including any future write tools the
 * calendar server might add) falls back to DEFAULT_UNKNOWN_TIER (Tier 3),
 * so a new tool can never silently run more permissively than intended.
 */
export const TIER_ASSIGNMENTS: TierAssignments = {
  core: {
    ping: PermissionTier.ReadOnly,
  },
  "google-calendar": {
    list_events: PermissionTier.ReadOnly,
    list_calendars: PermissionTier.ReadOnly,
  },
};

/** @deprecated Use {@link TIER_ASSIGNMENTS}. Kept for the Phase 0 test suite. */
export const PHASE0_TIER_ASSIGNMENTS: TierAssignments = TIER_ASSIGNMENTS;

// ---------------------------------------------------------------------------
// Confirmation seam (FR-2.5, R-2, R-3, R-6) - Phase 2 implements the real
// flow. Phase 1 wires the *enforcement* (a Tier 2/3 tool call is refused
// before it ever reaches the skill), but the actual "ask the user and wait
// for yes/no" interaction is not built yet.
// ---------------------------------------------------------------------------

/** Outcome of a confirmation request, once Phase 2 implements the real flow. */
export type ConfirmationDecision = "approved" | "denied" | "timed_out";

/** Plain-language details shown to the user when confirming a Tier 2/3 action (R-2). */
export interface ConfirmationRequest {
  tool: ToolIdentifier;
  tier: PermissionTier;
  /** Plain-English description of exactly what is about to happen. */
  description: string;
  /** The (validated) arguments that would be passed to the tool. */
  args: Record<string, unknown>;
}

/**
 * TODO(Phase 2): Implement the real confirmation flow.
 *
 * This function is the seam the tool-use loop (core/agent.ts) will call for
 * Tier 1 (if the user has opted into auto-approve) and Tier 2/3 tool calls.
 * It should:
 *   - Surface `request.description` to the user via voice and/or the UI
 *     (R-2: plain language, with specific names/amounts/dates).
 *   - Wait for an explicit "yes"/"confirm"/click (Tier 3: UI-click only per
 *     SEC-6) or "no"/"cancel".
 *   - Never be satisfiable by content returned from a skill (FR-2.7) - only
 *     the human user's own input counts.
 *   - For Tier 3, this can NEVER be configured to auto-approve (R-1).
 *
 * Phase 1 has no tools above Tier 0, so this is never called by the current
 * loop - see `refuseUnconfirmableTier` below for how Tier 2/3 calls are
 * handled until this lands.
 */
export type RequestConfirmation = (request: ConfirmationRequest) => Promise<ConfirmationDecision>;

/**
 * Phase 1 enforcement for Tier 2/3 tools: until `RequestConfirmation` (above)
 * is implemented in Phase 2, the tool-use loop must NOT execute any tool
 * whose tier requires confirmation (R-6: enforced by the Brain, before the
 * call leaves the machine). Returns a clear, user-facing refusal message if
 * the tool cannot run yet; returns `undefined` if it's safe to proceed
 * (Tier 0, or Tier 1 when `requiresConfirmation` is false).
 */
export function refuseUnconfirmableTier(
  { skill, tool }: ToolIdentifier,
  tier: PermissionTier,
): string | undefined {
  if (!requiresConfirmation(tier)) return undefined;

  return (
    `I can't run "${skill}.${tool}" yet - it's classified as ${tierLabel(tier)} ` +
    `(Tier ${tier}), which requires your confirmation before it can run. ` +
    `The confirmation flow isn't built yet (planned for Phase 2), so this ` +
    `action is refused for now rather than running unconfirmed.`
  );
}

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

import { existsSync } from "node:fs";
import { resolveFilesystemWriteTarget } from "../skills/filesystem/paths";

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
 *
 * If `args` and a matching entry in `classifierHooks` are supplied, the
 * classifier's result is used INSTEAD of the static table - this is how a
 * tool's tier can depend on its call arguments (e.g. calendar event create
 * with vs. without attendees). Callers that only want the static
 * classification (e.g. building the skill registry's tool list before any
 * call has been made) simply omit `args`/`classifierHooks`.
 */
export function classifyTool(
  { skill, tool }: ToolIdentifier,
  assignments: TierAssignments,
  args?: Record<string, unknown>,
  classifierHooks?: ClassifierHooks,
): PermissionTier {
  if (args && classifierHooks) {
    const hook = classifierHooks[skill]?.[tool];
    if (hook) return hook(args);
  }
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
    // create_event / update_event are argument-dependent (see
    // CLASSIFIER_HOOKS below) - no-attendee create/update is Tier 1,
    // attendee-affecting create/update is Tier 2.
    // delete_event and attendee add/remove always require confirmation.
    delete_event: PermissionTier.ExternalOrHardToReverse,
  },
  gmail: {
    search_messages: PermissionTier.ReadOnly,
    read_message: PermissionTier.ReadOnly,
    read_thread: PermissionTier.ReadOnly,
    list_unread: PermissionTier.ReadOnly,
    summarize_inbox: PermissionTier.ReadOnly,
    create_draft: PermissionTier.ReversibleInternal,
    mark_read: PermissionTier.ReversibleInternal,
    label_message: PermissionTier.ReversibleInternal,
    // send_email is ALWAYS Tier 2 (FR-4.4) - sending an email is external-
    // facing and cannot be unsent, regardless of arguments. No classifier
    // hook exists for it, and none should ever be added (R-6).
    send_email: PermissionTier.ExternalOrHardToReverse,
  },
  stripe: {
    get_balance: PermissionTier.ReadOnly,
    list_charges: PermissionTier.ReadOnly,
    list_payouts: PermissionTier.ReadOnly,
    list_customers: PermissionTier.ReadOnly,
    list_disputes: PermissionTier.ReadOnly,
    list_invoices: PermissionTier.ReadOnly,
    // refund_charge / cancel_subscription are ALWAYS Tier 3 (FR-5.3, R-2,
    // R-2a) - moving real money or cancelling recurring billing is
    // financial and cannot be undone, regardless of arguments. No
    // classifier hook exists for either, and none should ever be added
    // (R-6): unlike the calendar attendee-aware tiers, there is no "safe"
    // set of arguments that downgrades these below Tier 3.
    refund_charge: PermissionTier.FinancialOrIrreversible,
    cancel_subscription: PermissionTier.FinancialOrIrreversible,
  },
  // Local Filesystem skill (FR-6.1..6.7, Phase 4 Part C). All tools operate
  // ONLY within the configured allowed root (config.allowedDirectory,
  // skills/filesystem/paths.ts's resolveWithinRoot).
  filesystem: {
    // Read-only (FR-6.1/6.2): no confirmation needed.
    list_directory: PermissionTier.ReadOnly,
    read_file: PermissionTier.ReadOnly,
    get_file_info: PermissionTier.ReadOnly,
    // create_directory always creates something new (or no-ops if it
    // already exists as a directory) - reversible & internal (FR-6.3).
    create_directory: PermissionTier.ReversibleInternal,
    // write_file and move/rename are STATE-DEPENDENT (FR-6.3/6.5): creating
    // a new path is Tier 1, overwriting an existing path is Tier 2. See
    // CLASSIFIER_HOOKS.filesystem below - these static entries are the
    // Tier-1 (no-overwrite) fallback if a hook is somehow not consulted.
    write_file: PermissionTier.ReversibleInternal,
    move: PermissionTier.ReversibleInternal,
    // delete_file / delete_directory move the target into .jarvis-trash/
    // (FR-6.5's backup/undo snapshot) rather than truly deleting it, but
    // still require confirmation (Tier 2) - NOT Tier 3, since they are
    // recoverable.
    delete_file: PermissionTier.ExternalOrHardToReverse,
    delete_directory: PermissionTier.ExternalOrHardToReverse,
  },
};

/** @deprecated Use {@link TIER_ASSIGNMENTS}. Kept for the Phase 0 test suite. */
export const PHASE0_TIER_ASSIGNMENTS: TierAssignments = TIER_ASSIGNMENTS;

// ---------------------------------------------------------------------------
// Argument-aware tier classification (Phase 2).
//
// Some tools' tier depends on the arguments the model supplies - e.g.
// creating a calendar event with no attendees is Tier 1 (reversible,
// internal-only), but creating/updating one WITH attendees notifies other
// people and is Tier 2 (FR-3.3/3.4). `classifyTool` below consults this table
// FIRST; if a skill+tool has a classifier hook, its result wins over the
// static `TIER_ASSIGNMENTS` table. Tools with no hook fall back to the static
// table (and then to DEFAULT_UNKNOWN_TIER, R-5).
// ---------------------------------------------------------------------------

/** A per-tool function that computes a tier from the tool's call arguments. */
export type TierClassifier = (args: Record<string, unknown>) => PermissionTier;

/** classifier hooks: skill -> tool -> TierClassifier. */
export type ClassifierHooks = Record<string, Record<string, TierClassifier>>;

/**
 * Returns true if `args.attendees` (or `args.addAttendees`/`args.removeAttendees`)
 * is a non-empty array - i.e. the call would add/notify at least one attendee.
 */
function hasAttendees(args: Record<string, unknown>): boolean {
  for (const key of ["attendees", "addAttendees", "removeAttendees"]) {
    const value = args[key];
    if (Array.isArray(value) && value.length > 0) return true;
  }
  return false;
}

/**
 * Classifier hooks for the Google Calendar write tools (FR-3.3/3.4):
 *   - create_event / update_event: Tier 1 (no confirmation) if the call has
 *     no attendees; Tier 2 (confirmation required) if it adds/notifies
 *     attendees, since that affects other people's calendars.
 *   - delete_event and explicit attendee add/remove tools are always Tier 2
 *     via the static TIER_ASSIGNMENTS table (deletes are hard to reverse
 *     regardless of attendees).
 */
export const CLASSIFIER_HOOKS: ClassifierHooks = {
  "google-calendar": {
    create_event: (args) =>
      hasAttendees(args) ? PermissionTier.ExternalOrHardToReverse : PermissionTier.ReversibleInternal,
    update_event: (args) =>
      hasAttendees(args) ? PermissionTier.ExternalOrHardToReverse : PermissionTier.ReversibleInternal,
  },
  // Local Filesystem skill (FR-6.3/6.5): write_file and move/rename are
  // Tier 1 ("reversible & internal", no confirmation) when the target path
  // does NOT yet exist (creating something new), but Tier 2 ("external-
  // facing or hard to reverse", confirmation required) when it WOULD
  // overwrite an existing file/directory. This is a cheap, synchronous,
  // local `fs.existsSync` check (not a network call), done here so the
  // tool-use loop (core/agent.ts) classifies BEFORE dispatching the call -
  // mirroring the calendar attendee-aware hooks above.
  filesystem: {
    write_file: (args) => filesystemOverwriteTier(args, "path"),
    move: (args) => filesystemOverwriteTier(args, "destination"),
  },
};

/**
 * Tier for a filesystem write that may overwrite an existing path: Tier 2
 * if the (resolved, in-bounds) target path already exists, Tier 1 if it
 * doesn't exist yet or can't be resolved within the allowed root (in which
 * case the tool itself will refuse - no overwrite is possible, so Tier 1's
 * "no confirmation" is safe; the tool call will simply fail with a clear
 * error).
 */
function filesystemOverwriteTier(args: Record<string, unknown>, argKey: string): PermissionTier {
  const requested = args[argKey];
  const resolved = resolveFilesystemWriteTarget(requested);
  if (!resolved) return PermissionTier.ReversibleInternal;

  return existsSync(resolved) ? PermissionTier.ExternalOrHardToReverse : PermissionTier.ReversibleInternal;
}

// ---------------------------------------------------------------------------
// Plain-language descriptions for confirmation prompts (R-2).
//
// `describeToolCall` turns a tool name + its (validated) arguments into a
// human-readable sentence describing EXACTLY what is about to happen,
// including specific names/dates/times (with time zone) and recipients
// where applicable. core/agent.ts uses this to build the
// `ConfirmationRequest.description` shown to the user before a Tier 1+ tool
// (when confirmation is required) actually runs.
//
// This is intentionally a pure, best-effort formatter: it must never invent
// details that aren't in `args`, and it must never read instructions out of
// untrusted skill-returned content (FR-2.7) - it only looks at the
// model-supplied call arguments, which the user is being asked to approve.
// ---------------------------------------------------------------------------

/** Format an ISO-ish date-time string for display, including its offset/time zone if present. */
function formatWhen(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value;
}

function formatList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Build a plain-language description of a tool call for the confirmation
 * prompt (R-2). Falls back to a generic "run <skill>.<tool> with these
 * arguments" description for tools without a bespoke formatter.
 */
export function describeToolCall({ skill, tool }: ToolIdentifier, args: Record<string, unknown>): string {
  if (skill === "google-calendar") {
    return describeCalendarToolCall(tool, args);
  }
  if (skill === "gmail") {
    return describeGmailToolCall(tool, args);
  }
  if (skill === "stripe") {
    return describeStripeToolCall(tool, args);
  }
  if (skill === "filesystem") {
    return describeFilesystemToolCall(tool, args);
  }
  return `Run "${skill}.${tool}" with arguments: ${JSON.stringify(args)}`;
}

function describeCalendarToolCall(tool: string, args: Record<string, unknown>): string {
  const title = typeof args.title === "string" && args.title ? args.title : "(untitled event)";
  const start = formatWhen(args.start);
  const end = formatWhen(args.end);
  const attendees = formatList(args.attendees);
  const addAttendees = formatList(args.addAttendees);
  const removeAttendees = formatList(args.removeAttendees);
  const timeZone = typeof args.timeZone === "string" && args.timeZone ? args.timeZone : undefined;
  const eventId = typeof args.eventId === "string" && args.eventId ? args.eventId : undefined;

  const when = [start, end].filter(Boolean).join(" to ");
  const whenWithTz = when && timeZone ? `${when} (${timeZone})` : when;

  switch (tool) {
    case "create_event": {
      let description = `Create a calendar event "${title}"`;
      if (whenWithTz) description += ` from ${whenWithTz}`;
      if (attendees.length > 0) {
        description += `, and notify ${attendees.length} attendee(s): ${attendees.join(", ")}`;
      } else {
        description += " (no attendees, personal event only)";
      }
      if (typeof args.conflictWarning === "string" && args.conflictWarning) {
        description += `. WARNING: ${args.conflictWarning}`;
      }
      return description;
    }
    case "update_event": {
      let description = `Update calendar event ${eventId ? `"${eventId}"` : title}`;
      if (whenWithTz) description += `, moving it to ${whenWithTz}`;
      if (addAttendees.length > 0) {
        description += `, and notify new attendee(s): ${addAttendees.join(", ")}`;
      }
      if (removeAttendees.length > 0) {
        description += `, and remove attendee(s): ${removeAttendees.join(", ")}`;
      }
      if (attendees.length > 0) {
        description += `, and notify attendee(s): ${attendees.join(", ")}`;
      }
      if (typeof args.conflictWarning === "string" && args.conflictWarning) {
        description += `. WARNING: ${args.conflictWarning}`;
      }
      return description;
    }
    case "delete_event": {
      return `Permanently delete calendar event ${eventId ? `"${eventId}"` : ""}${title !== "(untitled event)" ? ` "${title}"` : ""}${whenWithTz ? ` (scheduled ${whenWithTz})` : ""}. This cannot be undone, and any attendees will be notified of the cancellation.`.replace(/\s+/g, " ").trim();
    }
    default:
      return `Run google-calendar.${tool} with arguments: ${JSON.stringify(args)}`;
  }
}

function describeGmailToolCall(tool: string, args: Record<string, unknown>): string {
  const to = formatList(args.to);
  const cc = formatList(args.cc);
  const bcc = formatList(args.bcc);
  const subject = typeof args.subject === "string" && args.subject ? args.subject : "(no subject)";
  const body = typeof args.body === "string" ? args.body : "";
  const bodyPreview = body.length > 140 ? `${body.slice(0, 140)}...` : body;

  switch (tool) {
    case "create_draft": {
      let description = `Save an email draft to ${to.length > 0 ? to.join(", ") : "(no recipient set)"}`;
      if (cc.length > 0) description += ` (cc: ${cc.join(", ")})`;
      description += ` with subject "${subject}"`;
      if (bodyPreview) description += ` and body starting: "${bodyPreview}"`;
      description += ". This saves a draft only - it will NOT be sent.";
      return description;
    }
    case "send_email": {
      const draftId = typeof args.draftId === "string" && args.draftId ? args.draftId : undefined;

      let description: string;
      if (draftId) {
        description = `Send the existing draft "${draftId}"`;
      } else {
        description = `SEND an email to ${to.length > 0 ? to.join(", ") : "(no recipient set)"}`;
        if (cc.length > 0) description += ` (cc: ${cc.join(", ")})`;
        if (bcc.length > 0) description += ` (bcc: ${bcc.join(", ")})`;
        description += ` with subject "${subject}"`;
        if (bodyPreview) description += ` and body starting: "${bodyPreview}"`;
      }
      description += ". This will SEND a real email - it cannot be unsent.";
      return description;
    }
    default:
      return `Run gmail.${tool} with arguments: ${JSON.stringify(args)}`;
  }
}

/**
 * Format a dollar amount for display, e.g. 25.5 -> "$25.50". Uses
 * toFixed(2) - the same "decimal amount + currency code" convention as
 * skills/stripe/server.ts's `toMoneyAmount` (FR-5.5), just formatted for a
 * human-readable confirmation sentence.
 */
function formatDollars(amount: number, currency = "usd"): string {
  const symbol = currency.toLowerCase() === "usd" ? "$" : "";
  const formatted = amount.toFixed(2);
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency.toUpperCase()}`;
}

/**
 * Plain-language descriptions for the Stripe WRITE tools (Tier 3, FR-5.3,
 * R-2/R-2a). MUST show exact dollar amounts (not raw cents) and currency,
 * the charge/subscription identifier, and state plainly that the action
 * moves real money / cannot be undone (R-2, FR-5.5).
 */
function describeStripeToolCall(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "refund_charge": {
      const chargeId = typeof args.chargeId === "string" && args.chargeId ? args.chargeId : "(unknown charge)";
      const amount = typeof args.amount === "number" ? args.amount : undefined;

      let description: string;
      if (amount !== undefined) {
        description = `Refund ${formatDollars(amount)} of charge "${chargeId}" (a PARTIAL refund)`;
      } else {
        description = `Refund the FULL amount of charge "${chargeId}"`;
      }
      description +=
        ". This moves real money out of your Stripe balance back to the customer and CANNOT be undone.";
      return description;
    }
    case "cancel_subscription": {
      const subscriptionId =
        typeof args.subscriptionId === "string" && args.subscriptionId ? args.subscriptionId : "(unknown subscription)";
      return (
        `Cancel Stripe subscription "${subscriptionId}" immediately. This stops recurring billing for ` +
        `this customer and CANNOT be undone.`
      );
    }
    default:
      return `Run stripe.${tool} with arguments: ${JSON.stringify(args)}`;
  }
}

/**
 * Plain-language descriptions for the Local Filesystem tools (Tier 1/2,
 * FR-6.3/6.5). For destructive ops, makes clear that deletes go to
 * `.jarvis-trash/` (recoverable) rather than vanishing.
 */
function describeFilesystemToolCall(tool: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" && args.path ? args.path : "(unknown path)";
  const destination =
    typeof args.destination === "string" && args.destination ? args.destination : "(unknown destination)";

  switch (tool) {
    case "write_file":
      return `Overwrite the existing file "${path}" with new content. The previous contents will be replaced.`;
    case "create_directory":
      return `Create directory "${path}".`;
    case "move":
      return `Move/rename "${path}" to "${destination}", overwriting whatever currently exists at the destination.`;
    case "delete_file":
      return `Delete file "${path}". It will be moved to .jarvis-trash/ inside the allowed folder, not permanently erased.`;
    case "delete_directory":
      return `Delete directory "${path}" (and everything inside it). It will be moved to .jarvis-trash/ inside the allowed folder, not permanently erased.`;
    default:
      return `Run filesystem.${tool} with arguments: ${JSON.stringify(args)}`;
  }
}

// ---------------------------------------------------------------------------
// Confirmation flow (FR-2.5, R-1..R-6) - Phase 2.
//
// Replaces the Phase 1 `refuseUnconfirmableTier` seam with a real "pause,
// describe, wait for confirm/cancel" mechanism. The tool-use loop
// (core/agent.ts) calls `requestConfirmation` (via an injected
// `ConfirmationProvider`) for any tool call whose tier requires confirmation.
// Only an explicit decision from the human user (via the UI or an injected
// test fake) counts - content returned from a skill can never satisfy this
// (FR-2.7).
// ---------------------------------------------------------------------------

/** Outcome of a confirmation request. */
export type ConfirmationDecision = "approved" | "denied" | "timed_out";

/** Plain-language details shown to the user when confirming a Tier 2/3 action (R-2). */
export interface ConfirmationRequest {
  tool: ToolIdentifier;
  tier: PermissionTier;
  /** Plain-English description of exactly what is about to happen. */
  description: string;
  /** The (validated) arguments that would be passed to the tool. */
  args: Record<string, unknown>;
  /**
   * R-2a: whether this request ALSO requires a TOTP authenticator code,
   * entered in the UI (never spoken - SEC-6), in addition to the voice/UI
   * "confirm". Always `true` for Tier 3, always `false` for Tier 0-2.
   */
  requiresTotp: boolean;
}

/**
 * Pluggable confirmation delivery (R-2, SEC-6):
 *   - The Electron UI implements this by showing a Confirm/Cancel prompt
 *     (plus a TOTP code field when `requiresTotp` is true) and waiting for
 *     the user's click (real IPC round-trip).
 *   - Tests inject a fake provider that auto-confirms or auto-cancels, so the
 *     confirmation flow can be exercised headlessly.
 *
 * Implementations must NEVER be satisfiable by anything other than the
 * human user's own input (FR-2.7) - in particular, never by parsing skill-
 * returned content for words like "confirm".
 */
export interface ConfirmationProvider {
  requestConfirmation(request: ConfirmationRequest): Promise<ConfirmationDecision>;
  /**
   * R-2a / SEC-6: for Tier 3 requests (`requiresTotp: true`), return the
   * 6-digit TOTP code the user entered in the UI alongside their
   * confirm/cancel decision, or `undefined` if none was provided.
   *
   * This is a SEPARATE method (not a field on the confirm/cancel decision)
   * so that:
   *   - Providers that never handle Tier 3 (most test fakes) don't need to
   *     implement it at all - `getTotpCode` is optional, and a missing
   *     implementation means "no code provided", which fails Tier 3 closed
   *     (R-1/R-2a).
   *   - The TOTP code is NEVER read from `request.args` or any
   *     skill-/model-supplied data (FR-2.7) - only from this explicit,
   *     human-entered-in-the-UI channel.
   *
   * Called only for requests where `requiresTotp` is true, immediately after
   * `requestConfirmation` resolves.
   */
  getTotpCode?(request: ConfirmationRequest): Promise<string | undefined>;
}

/**
 * R-1 (hardcoded, not configurable): Tier 3 actions can NEVER be
 * auto-approved by any provider or setting. No tool in Phase 2 is Tier 3,
 * but this guard exists so a future Tier 3 tool can't accidentally bypass
 * confirmation via a misconfigured provider.
 */
export function assertTierThreeNeverAutoApproved(tier: PermissionTier, decision: ConfirmationDecision): void {
  if (tier === PermissionTier.FinancialOrIrreversible && decision !== "approved" && decision !== "denied") {
    throw new Error("Tier 3 actions must receive an explicit approve/deny decision - never auto-approved (R-1).");
  }
}

/**
 * R-2a / SEC-6 (hardcoded, not configurable): a Tier 3 action can NEVER
 * execute without BOTH:
 *   - an explicit "approved" confirmation decision (R-1/R-2), AND
 *   - a verified TOTP code (`totpVerified === true`), checked by the caller
 *     via `security/totp.ts`'s `verifyTotpCode` against the human-entered
 *     code returned from `ConfirmationProvider.getTotpCode`.
 *
 * This function is the single choke point core/agent.ts must call before
 * dispatching a Tier 3 tool call - it throws if the two-factor requirement
 * is not fully satisfied, so a Tier 3 action literally cannot execute via the
 * code path without both factors (R-2a).
 *
 * No-op for Tier 0-2 (which have no TOTP requirement).
 */
export function assertTierThreeTwoFactorSatisfied(
  tier: PermissionTier,
  decision: ConfirmationDecision,
  totpVerified: boolean,
): void {
  if (tier !== PermissionTier.FinancialOrIrreversible) return;

  if (decision !== "approved" || !totpVerified) {
    throw new Error(
      "Tier 3 actions require BOTH an explicit 'approved' confirmation AND a verified TOTP " +
        "authenticator code (R-2a/SEC-6) - this action cannot execute without both.",
    );
  }
}

/**
 * Decide whether a tool call should proceed, given its tier and (if
 * required) a confirmation decision.
 *
 *   - Tier 0, or Tier 1 when `requiresConfirmation` is false: always proceeds
 *     (`decision` is ignored/undefined).
 *   - Tier 1 with confirmation enabled, Tier 2, Tier 3: proceeds only if
 *     `decision === "approved"`.
 *
 * This is a pure function so the confirmation *decision* (made by
 * `ConfirmationProvider`) stays separate from the *policy* of what to do with
 * it - easy to unit test without a real provider.
 */
export function shouldProceedAfterConfirmation(
  tier: PermissionTier,
  decision: ConfirmationDecision | undefined,
  totpVerified?: boolean,
): boolean {
  if (!requiresConfirmation(tier)) return true;
  if (decision !== "approved") return false;

  // R-2a: Tier 3 ALSO requires a verified TOTP code, in addition to the
  // "approved" confirmation decision. Tier 1/2 are unaffected.
  if (tier === PermissionTier.FinancialOrIrreversible) {
    return totpVerified === true;
  }

  return true;
}

/**
 * Phase 1 enforcement, retained for tools that somehow reach Tier 2/3 with NO
 * confirmation provider configured at all (should not happen once
 * core/agent.ts always supplies one, but kept as a defensive fallback /
 * documents the pre-Phase-2 behavior for any caller that doesn't wire a
 * provider). Returns a clear, user-facing refusal message if the tool cannot
 * run without confirmation and no provider is available; returns `undefined`
 * if it's safe to proceed (Tier 0, or Tier 1 when `requiresConfirmation` is
 * false).
 */
export function refuseUnconfirmableTier(
  { skill, tool }: ToolIdentifier,
  tier: PermissionTier,
): string | undefined {
  if (!requiresConfirmation(tier)) return undefined;

  return (
    `I can't run "${skill}.${tool}" - it's classified as ${tierLabel(tier)} ` +
    `(Tier ${tier}), which requires your confirmation before it can run, but ` +
    `no confirmation provider is configured. This action is refused rather ` +
    `than running unconfirmed.`
  );
}

// ---------------------------------------------------------------------------
// R-4: Global "Pause / Do-Nothing mode". When active, JARVIS can converse and
// read, but takes ZERO write actions (Tier 1+) across all skills, regardless
// of confirmation. core/agent.ts checks `isPaused()` before even requesting
// confirmation for a write tool.
// ---------------------------------------------------------------------------

let pauseModeOverride: boolean | undefined;

/**
 * Whether Pause/Do-Nothing mode is currently active. Backed by the settings
 * store (store/settings.ts key "pauseMode") in normal operation; tests can
 * call `setPauseModeOverride` to avoid touching the database.
 */
export function isPauseModeActive(getSettingFn: (key: string) => string | undefined): boolean {
  if (pauseModeOverride !== undefined) return pauseModeOverride;
  return getSettingFn("pauseMode") === "true";
}

/** Test-only seam: force `isPauseModeActive` to a fixed value, or `undefined` to clear the override. */
export function setPauseModeOverride(value: boolean | undefined): void {
  pauseModeOverride = value;
}

/**
 * Refusal message used when Pause/Do-Nothing mode (R-4) blocks a write tool
 * (Tier 1+) regardless of its confirmation status.
 */
export function pauseModeRefusal({ skill, tool }: ToolIdentifier, tier: PermissionTier): string {
  return (
    `I can't run "${skill}.${tool}" (Tier ${tier}, ${tierLabel(tier)}) right now - ` +
    `JARVIS is in Pause/Do-Nothing mode, which blocks all write actions until ` +
    `it's turned off. I can still read data and answer questions.`
  );
}

// ---------------------------------------------------------------------------
// Agent orchestration (PRD Section 6.2 / Section 15, FR-2.3, FR-2.6).
//
// Wires together the Brain (core/brain.ts), the skill registry
// (skills/registry.ts), the permission-tier framework
// (core/permissions.ts), the conversation transcript, and the activity log:
//
//   1. Record the user's message.
//   2. Collect the tools advertised by every connected skill and expose them
//      to the Brain (FR-2.3's tool-use loop).
//   3. When the Brain calls a tool, classify it into a permission tier
//      (R-6: enforced here, BEFORE the call reaches the skill, with
//      argument-aware classifiers - CLASSIFIER_HOOKS). R-4: if Pause/Do-
//      Nothing mode is active, any write tool (Tier 1+) is refused outright.
//      Otherwise, if the tier requires confirmation (Tier 2/3, or an opted-in
//      Tier 1), the loop pauses, builds a plain-language description (R-2),
//      and awaits a confirm/cancel decision from the injected
//      `ConfirmationProvider` before executing - or aborts on cancel.
//   4. Record every tool call (including confirmation decisions) - and the
//      overall chat turn - to the activity log (FR-2.6), and the model
//      call's cost to the cost ledger (FR-2.8).
//   5. Record the Brain's final reply and return it.
//
// This loop is generic: it does not know about "calendar" specifically. Any
// skill registered in skillRegistry (skills/registry.ts) flows through the
// same path.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { think, type BrainTool, type ConversationTurn, type ToolExecutionResult } from "./brain";
import {
  assertTierThreeTwoFactorSatisfied,
  classifyTool,
  describeToolCall,
  isPauseModeActive,
  pauseModeRefusal,
  requiresConfirmation,
  shouldProceedAfterConfirmation,
  CLASSIFIER_HOOKS,
  TIER_ASSIGNMENTS,
  PermissionTier,
  type ConfirmationDecision,
  type ConfirmationProvider,
} from "./permissions";
import { skillRegistry } from "../skills/registry";
import { recordMessage, getSessionMessages } from "../store/conversations";
import { recordActivity, type ActivityOutcome } from "../store/activityLog";
import { getSetting } from "../store/settings";
import { isTotpConfigured, verifyTotpCode, TOTP_NOT_CONFIGURED_MESSAGE } from "../security/totp";

export interface AgentResponse {
  sessionId: string;
  reply: string;
  stub: boolean;
}

/**
 * Default confirmation provider used when none is injected: refuses (treats
 * as "denied") rather than silently auto-approving. This mirrors the Phase 1
 * `refuseUnconfirmableTier` behavior for any tier-2/3 (or confirmation-
 * requiring tier-1) tool call when no real provider (Electron UI / test
 * fake) is wired up - safer than the alternative of hanging forever or
 * proceeding unconfirmed (R-1, R-2).
 */
const DENY_ALL_CONFIRMATION_PROVIDER: ConfirmationProvider = {
  async requestConfirmation() {
    return "denied";
  },
};

/** Generate a fresh session id for a new conversation. */
export function createSessionId(): string {
  return randomUUID();
}

/**
 * Separator between a skill id and a tool name in the namespaced tool name
 * sent to the model (e.g. "google-calendar__list_events"). Anthropic tool
 * names must match `^[a-zA-Z0-9_-]+$`, so a double underscore (unlikely to
 * collide with real skill/tool names, which use single underscores/hyphens)
 * is used rather than a character tools/skills might contain.
 */
const TOOL_NAME_SEPARATOR = "__";

function namespacedToolName(skillId: string, toolName: string): string {
  return `${skillId}${TOOL_NAME_SEPARATOR}${toolName}`;
}

/** Split a namespaced tool name back into its skill id and tool name. */
function splitNamespacedToolName(namespaced: string): { skillId: string; toolName: string } | undefined {
  const index = namespaced.indexOf(TOOL_NAME_SEPARATOR);
  if (index === -1) return undefined;
  return {
    skillId: namespaced.slice(0, index),
    toolName: namespaced.slice(index + TOOL_NAME_SEPARATOR.length),
  };
}

/**
 * Collect the tools exposed by every connected skill, in the Brain's
 * namespaced tool format. Tools are listed live from each skill's MCP
 * client on every turn - cheap for an in-process server (Phase 1) and keeps
 * this correct if a skill's tool set changes at runtime.
 */
async function collectBrainTools(): Promise<BrainTool[]> {
  const tools: BrainTool[] = [];

  for (const skill of skillRegistry.listConnected()) {
    const mcpTools = await skill.client.listTools();
    for (const tool of mcpTools) {
      tools.push({
        name: namespacedToolName(skill.id, tool.name),
        description: tool.description ?? "",
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      });
    }
  }

  return tools;
}

/** Extract the text content + error flag from an MCP `CallToolResult`. */
function toToolExecutionResult(raw: unknown): ToolExecutionResult {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "content" in raw &&
    Array.isArray((raw as { content: unknown }).content)
  ) {
    const content = (raw as { content: Array<{ type: string; text?: string }>; isError?: boolean }).content;
    const text = content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("\n");
    return { content: text || JSON.stringify(raw), isError: (raw as { isError?: boolean }).isError };
  }

  return { content: JSON.stringify(raw) };
}

/**
 * Build the `executeTool` callback passed to `think()`. Every call is:
 *   1. Mapped back to {skill, tool} (R-6 enforcement happens per-call, not
 *      per-tool-list, so it can't be bypassed by the model renaming things).
 *   2. Classified into a permission tier via TIER_ASSIGNMENTS and
 *      CLASSIFIER_HOOKS (argument-aware tiering, e.g. calendar create/update
 *      with vs. without attendees - FR-3.3/3.4).
 *   3. R-4: if Pause/Do-Nothing mode is active, ANY write tool (Tier 1+) is
 *      refused regardless of confirmation, before any confirmation prompt is
 *      shown.
 *   4. If the tier requires confirmation (Tier 2/3, or a Tier 1 tool that
 *      opts in), the tool-use loop PAUSES and asks the injected
 *      `ConfirmationProvider` for an explicit confirm/cancel decision (R-2,
 *      R-6). The decision (confirmed/cancelled) is always recorded to the
 *      activity log, whether or not the tool ultimately runs.
 *   5. Only on confirmation (or for tools that don't require it) is the call
 *      dispatched to the skill's MCP client; the outcome is recorded to the
 *      activity log (FR-2.6) with skill, tool, params, tier, and outcome.
 */
function buildToolExecutor(sessionId: string, confirmationProvider: ConfirmationProvider) {
  return async function executeTool(
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const split = splitNamespacedToolName(namespacedName);
    if (!split) {
      return { content: `Unknown tool "${namespacedName}" (not in skill__tool format).`, isError: true };
    }

    const { skillId, toolName } = split;
    const skill = skillRegistry.get(skillId);
    const tier = classifyTool({ skill: skillId, tool: toolName }, TIER_ASSIGNMENTS, args, CLASSIFIER_HOOKS);

    const client = skill?.status === "connected" ? skill.client : undefined;
    if (!client) {
      const message = `Skill "${skillId}" is not connected, so "${toolName}" cannot run.`;
      recordActivity({
        skill: skillId,
        tool: toolName,
        tier,
        params: { sessionId, args },
        outcome: "error",
        summary: message,
      });
      return { content: message, isError: true };
    }

    // R-4: Pause/Do-Nothing mode blocks ALL write tools (Tier 1+),
    // regardless of confirmation, checked BEFORE any confirmation prompt.
    if (tier !== PermissionTier.ReadOnly && isPauseModeActive(getSetting)) {
      const refusal = pauseModeRefusal({ skill: skillId, tool: toolName }, tier);
      recordActivity({
        skill: skillId,
        tool: toolName,
        tier,
        params: { sessionId, args },
        outcome: "denied",
        summary: refusal,
      });
      return { content: refusal, isError: true };
    }

    // R-1/R-2/R-6: pause and ask for confirmation if this tier requires it.
    // R-2a: Tier 3 ALSO requires a verified TOTP authenticator code, entered
    // in the UI (never spoken), in addition to the confirm/cancel decision.
    let confirmationDecision: ConfirmationDecision | undefined;
    let totpVerified = false;
    if (requiresConfirmation(tier)) {
      const description = describeToolCall({ skill: skillId, tool: toolName }, args);
      const requiresTotp = tier === PermissionTier.FinancialOrIrreversible;

      const confirmationRequest = {
        tool: { skill: skillId, tool: toolName },
        tier,
        description,
        args,
        requiresTotp,
      };

      confirmationDecision = await confirmationProvider.requestConfirmation(confirmationRequest);

      // R-2a: for Tier 3, also collect and verify the TOTP code BEFORE
      // recording the confirmation outcome, so the activity log reflects
      // whether two-factor was actually satisfied.
      let totpRefusalReason: string | undefined;
      if (requiresTotp && confirmationDecision === "approved") {
        const configured = await isTotpConfigured();
        if (!configured) {
          totpRefusalReason = TOTP_NOT_CONFIGURED_MESSAGE;
        } else {
          const totpCode = await confirmationProvider.getTotpCode?.(confirmationRequest);
          totpVerified = totpCode !== undefined && (await verifyTotpCode(totpCode));
          if (!totpVerified) {
            totpRefusalReason =
              "The TOTP authenticator code was missing or incorrect. Tier 3 actions require a valid " +
              "6-digit code from your authenticator app in addition to confirmation (R-2a).";
          }
        }
      }

      const approvedWithTwoFactor = shouldProceedAfterConfirmation(tier, confirmationDecision, totpVerified);

      recordActivity({
        skill: skillId,
        tool: toolName,
        tier,
        params: { sessionId, args },
        outcome: approvedWithTwoFactor ? "success" : "denied",
        summary: approvedWithTwoFactor
          ? `Confirmed: ${description}`
          : confirmationDecision === "approved" && requiresTotp
            ? `Cancelled (not run): ${description}. ${totpRefusalReason}`
            : `Cancelled (not run): ${description}`,
      });

      if (!approvedWithTwoFactor) {
        const message =
          confirmationDecision === "approved" && requiresTotp && totpRefusalReason
            ? `Cancelled - "${skillId}.${toolName}" was not run. ${totpRefusalReason}`
            : `Cancelled - "${skillId}.${toolName}" was not run because the user did not confirm it.`;
        return { content: message, isError: true };
      }

      // R-2a: belt-and-suspenders - this throws if somehow both factors were
      // not actually satisfied, so a Tier 3 action can never reach the
      // dispatch below without both (R-1, R-2a).
      assertTierThreeTwoFactorSatisfied(tier, confirmationDecision, totpVerified);
    }

    let outcome: ActivityOutcome = "success";
    let resultForLog: unknown;
    let executionResult: ToolExecutionResult;

    try {
      const raw = await client.callTool(toolName, args);
      resultForLog = raw;
      executionResult = toToolExecutionResult(raw);
      if (executionResult.isError) outcome = "error";
    } catch (error) {
      outcome = "error";
      executionResult = { content: `Error calling ${skillId}.${toolName}: ${(error as Error).message}`, isError: true };
      resultForLog = { error: (error as Error).message };
    }

    recordActivity({
      skill: skillId,
      tool: toolName,
      tier,
      params: { sessionId, args },
      result: resultForLog,
      outcome,
      summary: `${outcome === "success" ? "Ran" : "Failed running"} ${skillId}.${toolName} (Tier ${tier})`,
    });

    return executionResult;
  };
}

/**
 * Handle one turn of conversation: persist the user message, ask the Brain
 * for a reply (using the full session history for context and any tools
 * exposed by connected skills), persist the reply, and append a Tier 0
 * activity log entry for the overall chat exchange. Any tool calls the Brain
 * makes along the way are logged separately by `buildToolExecutor`.
 */
export async function handleUserMessage(
  sessionId: string,
  message: string,
  confirmationProvider: ConfirmationProvider = DENY_ALL_CONFIRMATION_PROVIDER,
): Promise<AgentResponse> {
  recordMessage(sessionId, "user", message);

  const history: ConversationTurn[] = getSessionMessages(sessionId)
    .filter(
      (msg): msg is typeof msg & { role: "user" | "assistant" } =>
        msg.role === "user" || msg.role === "assistant",
    )
    .map((msg) => ({ role: msg.role, content: msg.content }));

  const tools = await collectBrainTools();
  const executeTool = tools.length > 0 ? buildToolExecutor(sessionId, confirmationProvider) : undefined;

  const { text, stub } = await think(history, tools, executeTool);

  recordMessage(sessionId, "assistant", text);

  recordActivity({
    skill: "core",
    tool: "chat",
    tier: PermissionTier.ReadOnly,
    params: { sessionId, message },
    result: { reply: text, stub },
    outcome: "success",
    summary: stub
      ? "Replied with offline stub (no Anthropic API key configured)"
      : "Replied using the configured Brain model",
  });

  return { sessionId, reply: text, stub };
}

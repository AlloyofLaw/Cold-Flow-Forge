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
//      (R-6: enforced here, BEFORE the call reaches the skill) and either
//      execute it via the skill's MCP client, or refuse it if its tier
//      requires a confirmation flow that doesn't exist yet (Tier 2/3 -
//      see core/permissions.ts's `refuseUnconfirmableTier`).
//   4. Record every tool call - and the overall chat turn - to the activity
//      log (FR-2.6), and the model call's cost to the cost ledger (FR-2.8).
//   5. Record the Brain's final reply and return it.
//
// This loop is generic: it does not know about "calendar" specifically. Any
// skill registered in skillRegistry (skills/registry.ts) flows through the
// same path.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { think, type BrainTool, type ConversationTurn, type ToolExecutionResult } from "./brain";
import { classifyTool, refuseUnconfirmableTier, TIER_ASSIGNMENTS, PermissionTier } from "./permissions";
import { skillRegistry } from "../skills/registry";
import { recordMessage, getSessionMessages } from "../store/conversations";
import { recordActivity, type ActivityOutcome } from "../store/activityLog";

export interface AgentResponse {
  sessionId: string;
  reply: string;
  stub: boolean;
}

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
 *   2. Classified into a permission tier via TIER_ASSIGNMENTS.
 *   3. Refused with a clear message if that tier requires confirmation and
 *      no confirmation flow exists yet (Tier 2/3 in Phase 1 -
 *      see core/permissions.ts `refuseUnconfirmableTier`).
 *   4. Otherwise dispatched to the skill's MCP client and recorded to the
 *      activity log (FR-2.6) with skill, tool, params, tier, and outcome.
 */
function buildToolExecutor(sessionId: string) {
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
    const tier = classifyTool({ skill: skillId, tool: toolName }, TIER_ASSIGNMENTS);

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

    // R-6: Tier enforcement happens here, before the call reaches the
    // skill's MCP client. Tier 2/3 (and any Tier 1 tool that opts into
    // confirmation) are refused until Phase 2's confirmation flow exists.
    const refusal = refuseUnconfirmableTier({ skill: skillId, tool: toolName }, tier);
    if (refusal) {
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
export async function handleUserMessage(sessionId: string, message: string): Promise<AgentResponse> {
  recordMessage(sessionId, "user", message);

  const history: ConversationTurn[] = getSessionMessages(sessionId)
    .filter(
      (msg): msg is typeof msg & { role: "user" | "assistant" } =>
        msg.role === "user" || msg.role === "assistant",
    )
    .map((msg) => ({ role: msg.role, content: msg.content }));

  const tools = await collectBrainTools();
  const executeTool = tools.length > 0 ? buildToolExecutor(sessionId) : undefined;

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

// ---------------------------------------------------------------------------
// Agent orchestration (PRD Section 6.2 / Section 15).
//
// Wires together the Brain (core/brain.ts), the conversation transcript, and
// the activity log: given a user message, it records the message, asks the
// Brain for a reply, records the reply, and logs the exchange to the
// activity log at Tier 0 (read-only) - this is the "dummy action" the Phase
// 0 acceptance criteria refers to (a no-side-effect chat turn classified at
// Tier 0).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { think, type ConversationTurn } from "./brain";
import { PermissionTier } from "./permissions";
import { recordMessage, getSessionMessages } from "../store/conversations";
import { recordActivity } from "../store/activityLog";

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
 * Handle one turn of conversation: persist the user message, ask the Brain
 * for a reply (using the full session history for context), persist the
 * reply, and append a Tier 0 activity log entry for the exchange.
 */
export async function handleUserMessage(sessionId: string, message: string): Promise<AgentResponse> {
  recordMessage(sessionId, "user", message);

  const history: ConversationTurn[] = getSessionMessages(sessionId)
    .filter(
      (msg): msg is typeof msg & { role: "user" | "assistant" } =>
        msg.role === "user" || msg.role === "assistant",
    )
    .map((msg) => ({ role: msg.role, content: msg.content }));

  const { text, stub } = await think(history);

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

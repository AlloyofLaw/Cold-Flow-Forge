// ---------------------------------------------------------------------------
// The Brain (Agent Core) - PRD Section 6.2 / Section 15.
//
// Phase 0 scope: a single "reasoning" call to a Claude model when
// `ANTHROPIC_API_KEY` is set, with an empty tool list (FR-2.3's tool-use
// loop arrives once real skills exist). When no API key is configured, the
// Brain returns a clearly-labeled stub reply so JARVIS can run with zero
// external accounts (PRD Section 15).
//
// Every call - real or stubbed - is recorded to the cost ledger (FR-2.8),
// even though a stub call costs $0.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { recordCost } from "../store/costLedger";

export interface BrainReply {
  /** The text JARVIS should speak/display in response. */
  text: string;
  /** Whether this reply came from the real model or the offline stub. */
  stub: boolean;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

const STUB_PREFIX = "[STUB REPLY - no ANTHROPIC_API_KEY configured]";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

/**
 * Very rough cost estimate for Claude calls, used only so the cost ledger
 * has non-zero numbers to display in Phase 0. Real pricing should be kept
 * in sync with https://www.anthropic.com/pricing as models change.
 */
const PRICE_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICE_PER_MILLION_TOKENS_USD[model] ?? { input: 3, output: 15 };
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

/**
 * Produce a stubbed reply that echoes the user's message, clearly labeled
 * so it's never mistaken for a real model response (PRD Section 15 #2).
 */
function stubReply(userMessage: string): BrainReply {
  return {
    text: `${STUB_PREFIX} You said: "${userMessage}"`,
    stub: true,
  };
}

/**
 * Send a conversation to the Brain and get a reply.
 *
 * - If no Anthropic API key is configured, returns a stub reply immediately
 *   (no network call, $0 cost recorded).
 * - Otherwise, calls the configured `modelMain` with the conversation
 *   history and an empty tool list, and records the call's estimated cost.
 */
export async function think(history: ConversationTurn[]): Promise<BrainReply> {
  const lastUserTurn = [...history].reverse().find((turn) => turn.role === "user");
  const lastUserMessage = lastUserTurn?.content ?? "";

  if (!config.hasAnthropicApiKey) {
    const reply = stubReply(lastUserMessage);
    recordCost({
      provider: "anthropic",
      model: config.modelMain,
      inputUnits: 0,
      outputUnits: 0,
      unitKind: "tokens",
      estimatedCostUsd: 0,
    });
    return reply;
  }

  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: config.modelMain,
    max_tokens: 1024,
    messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
    tools: [], // FR-2.3: real tools arrive once skills are connected (Phase 1+).
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  recordCost({
    provider: "anthropic",
    model: config.modelMain,
    inputUnits: response.usage.input_tokens,
    outputUnits: response.usage.output_tokens,
    unitKind: "tokens",
    estimatedCostUsd: estimateCostUsd(
      config.modelMain,
      response.usage.input_tokens,
      response.usage.output_tokens,
    ),
  });

  return { text, stub: false };
}

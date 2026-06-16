// ---------------------------------------------------------------------------
// The Brain (Agent Core) - PRD Section 6.2 / Section 15.
//
// Phase 0 scope was a single "reasoning" call to a Claude model with an
// empty tool list. Phase 1 (FR-2.3) upgrades this to a generic MCP tool-use
// loop: the Brain is handed the set of tools advertised by registered
// skills, calls the model, and - if the model asks to use a tool - invokes
// the caller-supplied `executeTool` callback, feeds the result back as a
// `tool_result`, and repeats until the model produces a final text reply (or
// a turn limit is hit, to bound cost/latency per FR-8.1 and the Edge Cases
// table's "runaway loop" concern).
//
// This loop is intentionally generic: it knows nothing about calendars,
// email, etc. Each tool is just {name, description, input_schema} plus an
// executor function - core/agent.ts is what wires it to the skill registry
// and the permission-tier framework (R-6).
//
// When no API key is configured, the Brain returns a clearly-labeled stub
// reply so JARVIS can run with zero external accounts (PRD Section 15).
// Every call - real or stubbed - is recorded to the cost ledger (FR-2.8),
// even though a stub call costs $0.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { recordCost, getBudgetStatus } from "../store/costLedger";

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

/**
 * A single tool the Brain may call, in Anthropic's tool-use format. `name`
 * is expected to be globally unique across all registered skills - by
 * convention `<skill>__<tool>` (see core/agent.ts), so the executor can
 * recover which skill/tool was invoked.
 */
export interface BrainTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Result of executing a single tool call, fed back to the model. */
export interface ToolExecutionResult {
  /** Text content returned to the model as the `tool_result`. */
  content: string;
  /** If true, the model is told this tool call resulted in an error. */
  isError?: boolean;
}

/**
 * Callback that actually runs a tool call. Supplied by core/agent.ts, which
 * is responsible for permission-tier enforcement (R-6), dispatching to the
 * right skill's MCP client, and activity-log recording (FR-2.6) - the Brain
 * itself never talks to a skill directly.
 */
export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<ToolExecutionResult>;

/** Upper bound on tool-call round-trips per `think()` call (cost/runaway-loop guard). */
const MAX_TOOL_ITERATIONS = 8;

const STUB_PREFIX = "[STUB REPLY - no ANTHROPIC_API_KEY configured]";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

/**
 * Per-model $/token pricing used to estimate the cost of each call (FR-2.8).
 *
 * ASSUMPTION (documented, easy to update): these figures are based on the
 * published Anthropic API pricing for Claude Sonnet 4.5 ($3 / $15 per
 * million input/output tokens) and Claude Haiku 4.5 ($1 / $5 per million
 * input/output tokens) as of this writing - see
 * https://www.anthropic.com/pricing. If pricing changes, update this table
 * (a single place) rather than any per-call code. Any model not listed here
 * falls back to the Sonnet 4.5 rate as a conservative default.
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

const BUDGET_EXCEEDED_PREFIX = "[BUDGET CAP REACHED - restricted mode]";

/**
 * FR-8.3: reply used when the current month's cost ledger total has reached
 * or exceeded the configured monthly budget cap. JARVIS refuses to make
 * further PAID model calls (restricted mode) until the next calendar month,
 * or until the user raises `JARVIS_MONTHLY_BUDGET_USD` in settings/.env.
 * Like the offline stub, this records a $0 cost ledger entry and never calls
 * the Anthropic API.
 */
function budgetExceededReply(monthCostUsd: number, monthlyBudgetUsd: number): BrainReply {
  return {
    text:
      `${BUDGET_EXCEEDED_PREFIX} JARVIS has spent an estimated $${monthCostUsd.toFixed(2)} this month, ` +
      `at or above the configured monthly budget cap of $${monthlyBudgetUsd.toFixed(2)} (FR-8.3). ` +
      "To protect you from surprise bills, JARVIS will not make further paid model calls until next " +
      "month, or until you raise JARVIS_MONTHLY_BUDGET_USD in settings. I can still show you what's " +
      "in the activity log and cost ledger.",
    stub: true,
  };
}

/** Record one model call's usage to the cost ledger (FR-2.8). */
function recordModelCost(usage: Anthropic.Usage): void {
  recordCost({
    provider: "anthropic",
    model: config.modelMain,
    inputUnits: usage.input_tokens,
    outputUnits: usage.output_tokens,
    unitKind: "tokens",
    estimatedCostUsd: estimateCostUsd(config.modelMain, usage.input_tokens, usage.output_tokens),
  });
}

function textFromContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Send a conversation to the Brain and get a reply, running a generic MCP
 * tool-use loop (FR-2.3) when `tools`/`executeTool` are supplied.
 *
 * - If no Anthropic API key is configured, returns a stub reply immediately
 *   (no network call, $0 cost recorded). Stub mode never calls `executeTool`.
 * - Otherwise, calls the configured `modelMain` with the conversation
 *   history and the supplied tool list. If the model responds with one or
 *   more `tool_use` blocks, each is executed via `executeTool`, the results
 *   are sent back as `tool_result` blocks, and the loop repeats (bounded by
 *   `MAX_TOOL_ITERATIONS`) until the model returns a plain text reply.
 * - Every model round-trip - including each tool-use iteration - is recorded
 *   to the cost ledger (FR-2.8).
 */
export async function think(
  history: ConversationTurn[],
  tools: BrainTool[] = [],
  executeTool?: ToolExecutor,
): Promise<BrainReply> {
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

  // FR-8.3: if the current month's cost ledger total has already reached the
  // configured monthly budget cap, switch to restricted mode - refuse to
  // make a paid model call and return a clearly-labeled stub reply instead
  // (still recording a $0 cost ledger entry, like the no-API-key stub path).
  const budget = getBudgetStatus(config.monthlyBudgetUsd);
  if (budget.state === "exceeded") {
    const reply = budgetExceededReply(budget.monthCostUsd, budget.monthlyBudgetUsd);
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

  const anthropicTools: Anthropic.Tool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create({
      model: config.modelMain,
      max_tokens: 1024,
      messages,
      tools: anthropicTools,
    });

    recordModelCost(response.usage);

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    // No tool calls (or no executor to run them): the model's text is the
    // final reply.
    if (toolUseBlocks.length === 0 || !executeTool) {
      return { text: textFromContent(response.content), stub: false };
    }

    // Append the assistant's turn (including its tool_use blocks) before
    // the tool_result turn, as the Anthropic API requires.
    messages.push({ role: "assistant", content: response.content });

    const resultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await executeTool(block.name, (block.input ?? {}) as Record<string, unknown>);
      resultBlocks.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.isError,
      });
    }

    messages.push({ role: "user", content: resultBlocks });
  }

  // Turn-limit guard (cost/runaway-loop protection, Section 10): if the
  // model is still calling tools after MAX_TOOL_ITERATIONS, stop and report
  // rather than looping indefinitely.
  return {
    text:
      "I had to stop after several tool calls without reaching a final answer. " +
      "Please try rephrasing your request.",
    stub: false,
  };
}

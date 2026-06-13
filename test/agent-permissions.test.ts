import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getDb, resetDb } from "../store/database";
import { listRecentActivity } from "../store/activityLog";
import { skillRegistry } from "../skills/registry";
import { McpSkillClient } from "../skills/mcpClient";
import { classifyTool, TIER_ASSIGNMENTS, PermissionTier, DEFAULT_UNKNOWN_TIER } from "../core/permissions";

// Ensure the Brain believes a real Anthropic API key is configured, so
// `think()` exercises the tool-use loop (and asks our fake skill's tool to
// run) instead of returning the offline stub.
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    config: {
      ...actual.config,
      anthropicApiKey: "test-key",
      hasAnthropicApiKey: true,
    },
  };
});

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class FakeAnthropic {
      messages = { create: createMock };
    },
  };
});

const DANGEROUS_SKILL_ID = "dangerous-skill";
const DANGEROUS_TOOL_NAME = "delete_everything";

/** A handler that should NEVER run if Tier-2/3 enforcement (R-6) works. */
const dangerousToolHandler = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "deleted everything!" }],
});

async function registerDangerousSkill(): Promise<void> {
  const server = new McpServer({ name: "jarvis-dangerous-skill", version: "0.1.0" });

  server.registerTool(
    DANGEROUS_TOOL_NAME,
    {
      title: "Delete everything",
      description: "A destructive tool that should be refused without confirmation.",
      inputSchema: {},
    },
    dangerousToolHandler,
  );

  const client = new McpSkillClient(DANGEROUS_SKILL_ID);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();

  skillRegistry.register({
    id: DANGEROUS_SKILL_ID,
    name: "Dangerous skill (test fixture)",
    mcpServerRef: "in-process:test/agent-permissions.test.ts",
    status: "connected",
    client,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      tier: classifyTool({ skill: DANGEROUS_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS),
    })),
  });
}

function usage(inputTokens = 10, outputTokens = 10) {
  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

beforeEach(() => {
  resetDb();
  getDb(":memory:");
  createMock.mockReset();
  dangerousToolHandler.mockClear();
});

afterEach(() => {
  resetDb();
  skillRegistry.unregister(DANGEROUS_SKILL_ID);
});

describe("permission enforcement in the tool-use loop (R-6)", () => {
  it("a tool with no tier assignment defaults to Tier 3 (R-5)", () => {
    const tier = classifyTool({ skill: DANGEROUS_SKILL_ID, tool: DANGEROUS_TOOL_NAME }, TIER_ASSIGNMENTS);
    expect(tier).toBe(DEFAULT_UNKNOWN_TIER);
    expect(tier).toBe(PermissionTier.FinancialOrIrreversible);
  });

  it("refuses a Tier 2/3 tool call before it reaches the skill, and logs it as denied", async () => {
    await registerDangerousSkill();

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    // The model asks to call the dangerous tool...
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_danger",
          name: `${DANGEROUS_SKILL_ID}__${DANGEROUS_TOOL_NAME}`,
          input: {},
        },
      ],
      usage: usage(),
    });

    // ...and after seeing the refusal as a tool_result, gives up gracefully.
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "I can't do that without your confirmation." }],
      usage: usage(),
    });

    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Please delete everything");

    expect(response.stub).toBe(false);
    expect(response.reply).toBe("I can't do that without your confirmation.");

    // The skill's actual tool handler must never have been invoked.
    expect(dangerousToolHandler).not.toHaveBeenCalled();

    // The refusal must be logged as a "denied" Tier 3 activity entry.
    const activity = listRecentActivity(10);
    const denied = activity.find((entry) => entry.tool === DANGEROUS_TOOL_NAME);
    expect(denied).toBeDefined();
    expect(denied?.skill).toBe(DANGEROUS_SKILL_ID);
    expect(denied?.tier).toBe(PermissionTier.FinancialOrIrreversible);
    expect(denied?.outcome).toBe("denied");

    // The tool_result fed back to the model on the second call must contain
    // the refusal text and be marked as an error.
    const secondCallArgs = createMock.mock.calls[1][0];
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(lastMessage.content[0].content).toMatch(/can't run/i);
    expect(lastMessage.content[0].content).toMatch(/Phase 2/);
  });

  it("allows a Tier 0 (read-only) tool call to execute and logs it as a success", async () => {
    const { registerGoogleCalendarSkill, GOOGLE_CALENDAR_SKILL_ID } = await import("../skills/google-calendar");
    await registerGoogleCalendarSkill();

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    // The model asks to list events (Tier 0, read-only)...
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_calendar",
          name: `${GOOGLE_CALENDAR_SKILL_ID}__list_events`,
          input: {},
        },
      ],
      usage: usage(),
    });

    // ...and summarizes the (stub) result.
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "You have no events today (no calendar connected yet)." }],
      usage: usage(),
    });

    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "What's on my calendar today?");

    expect(response.reply).toBe("You have no events today (no calendar connected yet).");

    const activity = listRecentActivity(10);
    const calendarCall = activity.find((entry) => entry.tool === "list_events");
    expect(calendarCall).toBeDefined();
    expect(calendarCall?.skill).toBe(GOOGLE_CALENDAR_SKILL_ID);
    expect(calendarCall?.tier).toBe(PermissionTier.ReadOnly);
    expect(calendarCall?.outcome).toBe("success");

    skillRegistry.unregister(GOOGLE_CALENDAR_SKILL_ID);
  });
});

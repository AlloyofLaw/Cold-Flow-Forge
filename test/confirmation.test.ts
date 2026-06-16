import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getDb, resetDb } from "../store/database";
import { listRecentActivity } from "../store/activityLog";
import { skillRegistry } from "../skills/registry";
import { McpSkillClient } from "../skills/mcpClient";
import {
  classifyTool,
  setPauseModeOverride,
  TIER_ASSIGNMENTS,
  PermissionTier,
  type ConfirmationDecision,
  type ConfirmationProvider,
  type ConfirmationRequest,
} from "../core/permissions";

// Ensure the Brain believes a real Anthropic API key is configured, so
// `think()` exercises the tool-use loop instead of returning the offline stub.
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

// A fixture skill with a Tier 2 (external/hard-to-reverse) tool, used to
// exercise the confirmation flow without depending on a real skill's tier
// assignments.
const CONFIRM_SKILL_ID = "confirm-skill";
const CONFIRM_TOOL_NAME = "send_external_notification";

const confirmToolHandler = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "notification sent!" }],
});

async function registerConfirmSkill(): Promise<void> {
  const server = new McpServer({ name: "jarvis-confirm-skill", version: "0.1.0" });

  server.registerTool(
    CONFIRM_TOOL_NAME,
    {
      title: "Send an external notification",
      description: "A Tier 2 tool fixture used to test the confirmation flow.",
      inputSchema: {},
    },
    confirmToolHandler,
  );

  const client = new McpSkillClient(CONFIRM_SKILL_ID);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();

  skillRegistry.register({
    id: CONFIRM_SKILL_ID,
    name: "Confirmation flow fixture skill",
    mcpServerRef: "in-process:test/confirmation.test.ts",
    status: "connected",
    client,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      tier: classifyTool({ skill: CONFIRM_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS),
    })),
  });
}

function usage(inputTokens = 10, outputTokens = 10) {
  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

/** A fake ConfirmationProvider that records requests and returns a fixed decision. */
function fakeProvider(decision: ConfirmationDecision): ConfirmationProvider & { requests: ConfirmationRequest[] } {
  const requests: ConfirmationRequest[] = [];
  return {
    requests,
    async requestConfirmation(request) {
      requests.push(request);
      return decision;
    },
  };
}

beforeEach(() => {
  resetDb();
  getDb(":memory:");
  createMock.mockReset();
  confirmToolHandler.mockClear();
  setPauseModeOverride(undefined);

  // Force this fixture tool to Tier 2 via TIER_ASSIGNMENTS for the duration
  // of these tests (avoids depending on a real skill's tier table).
  TIER_ASSIGNMENTS[CONFIRM_SKILL_ID] = {
    [CONFIRM_TOOL_NAME]: PermissionTier.ExternalOrHardToReverse,
  };
});

afterEach(() => {
  resetDb();
  skillRegistry.unregister(CONFIRM_SKILL_ID);
  setPauseModeOverride(undefined);
  delete TIER_ASSIGNMENTS[CONFIRM_SKILL_ID];
});

describe("confirmation flow (R-1, R-2, R-4, R-6)", () => {
  it("pauses a Tier 2 tool call, describes it, and only runs it after the provider confirms", async () => {
    await registerConfirmSkill();
    const { handleUserMessage, createSessionId } = await import("../core/agent");

    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_confirm",
          name: `${CONFIRM_SKILL_ID}__${CONFIRM_TOOL_NAME}`,
          input: { foo: "bar" },
        },
      ],
      usage: usage(),
    });
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Done - notification sent." }],
      usage: usage(),
    });

    const provider = fakeProvider("approved");
    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Send the external notification", provider);

    expect(response.reply).toBe("Done - notification sent.");

    // The provider was asked, with a plain-language description (R-2) and
    // the correct tier.
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].tier).toBe(PermissionTier.ExternalOrHardToReverse);
    expect(provider.requests[0].description.length).toBeGreaterThan(0);
    expect(provider.requests[0].args).toEqual({ foo: "bar" });

    // Only after confirmation does the underlying tool actually run.
    expect(confirmToolHandler).toHaveBeenCalledTimes(1);

    // Both the confirmation decision AND the executed tool call are logged.
    const activity = listRecentActivity(10);
    const confirmedEntry = activity.find((e) => e.tool === CONFIRM_TOOL_NAME && e.outcome === "success" && e.summary?.startsWith("Confirmed:"));
    expect(confirmedEntry).toBeDefined();
    const ranEntry = activity.find((e) => e.tool === CONFIRM_TOOL_NAME && e.summary?.startsWith("Ran"));
    expect(ranEntry).toBeDefined();
  });

  it("a cancel decision prevents execution and is logged, without running the tool", async () => {
    await registerConfirmSkill();
    const { handleUserMessage, createSessionId } = await import("../core/agent");

    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_confirm",
          name: `${CONFIRM_SKILL_ID}__${CONFIRM_TOOL_NAME}`,
          input: {},
        },
      ],
      usage: usage(),
    });
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Okay, I won't send it." }],
      usage: usage(),
    });

    const provider = fakeProvider("denied");
    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Send the external notification", provider);

    expect(response.reply).toBe("Okay, I won't send it.");

    // The provider was asked...
    expect(provider.requests).toHaveLength(1);

    // ...but the underlying tool never ran.
    expect(confirmToolHandler).not.toHaveBeenCalled();

    // The cancellation is recorded as a "denied" activity entry.
    const activity = listRecentActivity(10);
    const cancelled = activity.find((e) => e.tool === CONFIRM_TOOL_NAME);
    expect(cancelled).toBeDefined();
    expect(cancelled?.outcome).toBe("denied");
    expect(cancelled?.summary).toMatch(/cancelled/i);

    // The tool_result fed back to the model reports the cancellation.
    const secondCallArgs = createMock.mock.calls[1][0];
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1];
    expect(lastMessage.content[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(lastMessage.content[0].content).toMatch(/cancelled/i);
  });

  it("when no confirmation provider is injected, a Tier 2 tool is denied by default (never auto-approved)", async () => {
    await registerConfirmSkill();
    const { handleUserMessage, createSessionId } = await import("../core/agent");

    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_confirm",
          name: `${CONFIRM_SKILL_ID}__${CONFIRM_TOOL_NAME}`,
          input: {},
        },
      ],
      usage: usage(),
    });
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "I can't do that without confirmation." }],
      usage: usage(),
    });

    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "Send the external notification");

    expect(confirmToolHandler).not.toHaveBeenCalled();
  });

  it("R-4: Pause/Do-Nothing mode blocks a Tier 1+ tool even if the provider would confirm", async () => {
    await registerConfirmSkill();
    setPauseModeOverride(true);

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_confirm",
          name: `${CONFIRM_SKILL_ID}__${CONFIRM_TOOL_NAME}`,
          input: {},
        },
      ],
      usage: usage(),
    });
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "JARVIS is paused right now." }],
      usage: usage(),
    });

    const provider = fakeProvider("approved");
    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Send the external notification", provider);

    expect(response.reply).toBe("JARVIS is paused right now.");

    // Pause mode blocks BEFORE the confirmation provider is even consulted.
    expect(provider.requests).toHaveLength(0);
    expect(confirmToolHandler).not.toHaveBeenCalled();

    const activity = listRecentActivity(10);
    const paused = activity.find((e) => e.tool === CONFIRM_TOOL_NAME);
    expect(paused?.outcome).toBe("denied");
    expect(paused?.summary).toMatch(/pause/i);
  });

  it("R-4: Pause/Do-Nothing mode does NOT block Tier 0 (read-only) tools", async () => {
    setPauseModeOverride(true);

    const { registerGoogleCalendarSkill, GOOGLE_CALENDAR_SKILL_ID } = await import("../skills/google-calendar");
    await registerGoogleCalendarSkill();

    const { handleUserMessage, createSessionId } = await import("../core/agent");

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
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "You have no events today." }],
      usage: usage(),
    });

    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "What's on my calendar?");

    expect(response.reply).toBe("You have no events today.");

    const activity = listRecentActivity(10);
    const calendarCall = activity.find((e) => e.tool === "list_events");
    expect(calendarCall?.outcome).toBe("success");

    skillRegistry.unregister(GOOGLE_CALENDAR_SKILL_ID);
  });
});

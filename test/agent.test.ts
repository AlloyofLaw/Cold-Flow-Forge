import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDb } from "../store/database";
import { listRecentActivity } from "../store/activityLog";
import { getSessionMessages } from "../store/conversations";
import { getTodayCost } from "../store/costLedger";

// Ensure the Brain runs in stub mode for this test (no ANTHROPIC_API_KEY).
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    config: {
      ...actual.config,
      anthropicApiKey: "",
      hasAnthropicApiKey: false,
    },
  };
});

beforeEach(() => {
  resetDb();
  getDb(":memory:");
});

afterEach(() => {
  resetDb();
});

describe("agent (stub mode)", () => {
  it("echoes a stub reply, persists the transcript, and logs a Tier 0 activity entry", async () => {
    const { handleUserMessage, createSessionId } = await import("../core/agent");
    const { PermissionTier } = await import("../core/permissions");

    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Hello JARVIS");

    expect(response.stub).toBe(true);
    expect(response.reply).toContain("Hello JARVIS");
    expect(response.reply).toMatch(/STUB REPLY/);

    const messages = getSessionMessages(sessionId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0].content).toBe("Hello JARVIS");

    const activity = listRecentActivity(10);
    expect(activity).toHaveLength(1);
    expect(activity[0].skill).toBe("core");
    expect(activity[0].tool).toBe("chat");
    expect(activity[0].tier).toBe(PermissionTier.ReadOnly);
    expect(activity[0].outcome).toBe("success");

    // Stub calls record a $0 entry in the cost ledger (FR-2.8).
    expect(getTodayCost()).toBe(0);
  });

  it("maintains conversation history across turns", async () => {
    const { handleUserMessage, createSessionId } = await import("../core/agent");

    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "first message");
    await handleUserMessage(sessionId, "second message");

    const messages = getSessionMessages(sessionId);
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.content)).toEqual([
      "first message",
      expect.stringContaining("first message"),
      "second message",
      expect.stringContaining("second message"),
    ]);
  });
});

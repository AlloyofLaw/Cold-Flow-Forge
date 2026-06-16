import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDb } from "../store/database";
import { listRecentActivity } from "../store/activityLog";
import { skillRegistry } from "../skills/registry";
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
  setPauseModeOverride(undefined);
});

afterEach(() => {
  resetDb();
  skillRegistry.unregister("gmail");
  setPauseModeOverride(undefined);
});

describe("Gmail send_email (FR-4.4, Tier 2, R-2)", () => {
  it("is classified as Tier 2 (ExternalOrHardToReverse)", async () => {
    expect(classifyTool({ skill: "gmail", tool: "send_email" }, TIER_ASSIGNMENTS)).toBe(
      PermissionTier.ExternalOrHardToReverse,
    );
  });

  it("ALWAYS requires confirmation, with a description showing recipients/subject/body preview and 'cannot be unsent' (R-2), even in stub mode (no Google account connected)", async () => {
    const { registerGmailSkill, GMAIL_SKILL_ID } = await import("../skills/gmail");
    await registerGmailSkill();

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_send",
          name: `${GMAIL_SKILL_ID}__send_email`,
          input: {
            to: ["alice@example.com"],
            cc: ["bob@example.com"],
            subject: "Q3 numbers",
            body: "Here are the Q3 numbers you asked for. Let me know if you have questions.",
          },
        },
      ],
      usage: usage(),
    });
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Sent the email to Alice." }],
      usage: usage(),
    });

    const provider = fakeProvider("approved");
    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Send Alice the Q3 numbers", provider);

    expect(response.reply).toBe("Sent the email to Alice.");

    // The provider was asked exactly once, with a Tier 2 plain-language
    // description (R-2) that shows recipients, subject, and a body preview,
    // and makes the irreversibility explicit.
    expect(provider.requests).toHaveLength(1);
    const request = provider.requests[0];
    expect(request.tier).toBe(PermissionTier.ExternalOrHardToReverse);
    expect(request.description).toContain("alice@example.com");
    expect(request.description).toContain("bob@example.com");
    expect(request.description).toContain("Q3 numbers");
    expect(request.description).toContain("Here are the Q3 numbers you asked for");
    expect(request.description).toMatch(/cannot be unsent/i);

    // The tool actually "ran" (in stub mode - no Google account connected -
    // it returns a stub wouldSend payload, but confirmation was still required
    // and the call still went through the executor/activity log).
    const activity = listRecentActivity(10);
    const ranEntry = activity.find((e) => e.tool === "send_email" && e.summary?.startsWith("Ran"));
    expect(ranEntry).toBeDefined();
    const confirmedEntry = activity.find((e) => e.tool === "send_email" && e.summary?.startsWith("Confirmed:"));
    expect(confirmedEntry).toBeDefined();
  });

  it("a cancel decision blocks send_email and is logged, without sending anything", async () => {
    const { registerGmailSkill, GMAIL_SKILL_ID } = await import("../skills/gmail");
    await registerGmailSkill();

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_send",
          name: `${GMAIL_SKILL_ID}__send_email`,
          input: {
            to: ["alice@example.com"],
            subject: "Q3 numbers",
            body: "Here are the numbers.",
          },
        },
      ],
      usage: usage(),
    });
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Okay, I won't send that email." }],
      usage: usage(),
    });

    const provider = fakeProvider("denied");
    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Send Alice the Q3 numbers", provider);

    expect(response.reply).toBe("Okay, I won't send that email.");
    expect(provider.requests).toHaveLength(1);

    const activity = listRecentActivity(10);
    const cancelled = activity.find((e) => e.tool === "send_email");
    expect(cancelled).toBeDefined();
    expect(cancelled?.outcome).toBe("denied");
    expect(cancelled?.summary).toMatch(/cancelled/i);

    // No "Ran" entry was logged for send_email - the tool never executed.
    const ranEntry = activity.find((e) => e.tool === "send_email" && e.summary?.startsWith("Ran"));
    expect(ranEntry).toBeUndefined();
  });

  it("with no confirmation provider injected, send_email is denied by default (never auto-approved, R-1)", async () => {
    const { registerGmailSkill, GMAIL_SKILL_ID } = await import("../skills/gmail");
    await registerGmailSkill();

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_send",
          name: `${GMAIL_SKILL_ID}__send_email`,
          input: {
            to: ["alice@example.com"],
            subject: "Q3 numbers",
            body: "Here are the numbers.",
          },
        },
      ],
      usage: usage(),
    });
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "I can't send that without your confirmation." }],
      usage: usage(),
    });

    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "Send Alice the Q3 numbers");

    const activity = listRecentActivity(10);
    const ranEntry = activity.find((e) => e.tool === "send_email" && e.summary?.startsWith("Ran"));
    expect(ranEntry).toBeUndefined();
  });
});

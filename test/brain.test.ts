import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDb } from "../store/database";
import { getTodayCost } from "../store/costLedger";

// Ensure the Brain believes a real Anthropic API key is configured, so
// `think()` exercises the tool-use loop instead of the offline stub.
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

// Mock the Anthropic SDK so the tool-use loop runs against canned responses
// instead of a real network call (FR-2.3: generic MCP tool-use loop).
const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class FakeAnthropic {
      messages = { create: createMock };
    },
  };
});

beforeEach(() => {
  resetDb();
  getDb(":memory:");
  createMock.mockReset();
});

afterEach(() => {
  resetDb();
});

function usage(inputTokens = 10, outputTokens = 10) {
  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

describe("think() tool-use loop", () => {
  it("returns plain text immediately when the model makes no tool calls", async () => {
    const { think } = await import("../core/brain");

    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello there!" }],
      usage: usage(),
    });

    const result = await think([{ role: "user", content: "Hi" }], [], undefined);

    expect(result.stub).toBe(false);
    expect(result.text).toBe("Hello there!");
    expect(createMock).toHaveBeenCalledTimes(1);

    // Even a "no tools" call records a cost ledger entry (FR-2.8).
    expect(getTodayCost()).toBeGreaterThan(0);
  });

  it("executes a tool call via the provided executor, feeds the result back, and returns the final reply", async () => {
    const { think } = await import("../core/brain");

    const tools = [
      {
        name: "fake-skill__do_thing",
        description: "A fake tool for testing.",
        inputSchema: { type: "object", properties: {} },
      },
    ];

    const executeTool = vi.fn().mockResolvedValue({ content: "tool ran ok" });

    // First call: model asks to use the tool.
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "toolu_123",
          name: "fake-skill__do_thing",
          input: { foo: "bar" },
        },
      ],
      usage: usage(),
    });

    // Second call: model responds with the final text after seeing the tool result.
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "All done." }],
      usage: usage(),
    });

    const result = await think([{ role: "user", content: "Do the thing" }], tools, executeTool);

    expect(result.text).toBe("All done.");
    expect(result.stub).toBe(false);

    // The executor was called with the namespaced tool name and the model's input.
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("fake-skill__do_thing", { foo: "bar" });

    // Two round trips: one that asked for the tool, one with the final reply.
    expect(createMock).toHaveBeenCalledTimes(2);

    // The second call's messages must include the tool_result fed back to the model.
    const secondCallArgs = createMock.mock.calls[1][0];
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_123",
      content: "tool ran ok",
    });
  });

  it("stops after MAX_TOOL_ITERATIONS if the model keeps calling tools", async () => {
    const { think } = await import("../core/brain");

    const tools = [
      {
        name: "fake-skill__loop_forever",
        description: "Always asks to be called again.",
        inputSchema: { type: "object", properties: {} },
      },
    ];

    const executeTool = vi.fn().mockResolvedValue({ content: "ok" });

    // Every call returns another tool_use, never a plain text reply.
    createMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_loop",
          name: "fake-skill__loop_forever",
          input: {},
        },
      ],
      usage: usage(),
    });

    const result = await think([{ role: "user", content: "Loop please" }], tools, executeTool);

    expect(result.stub).toBe(false);
    expect(result.text).toMatch(/stop after several tool calls/i);
    // Bounded by MAX_TOOL_ITERATIONS (8).
    expect(createMock).toHaveBeenCalledTimes(8);
  });
});

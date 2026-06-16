import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDb } from "../store/database";
import { recordCost, getBudgetStatus } from "../store/costLedger";

// Ensure the Brain believes a real Anthropic API key is configured, so
// `think()` exercises the tool-use loop instead of the offline stub - we want
// to verify the budget cap short-circuit happens BEFORE any model call.
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    config: {
      ...actual.config,
      anthropicApiKey: "test-key",
      hasAnthropicApiKey: true,
      monthlyBudgetUsd: 10,
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

beforeEach(() => {
  resetDb();
  getDb(":memory:");
  createMock.mockReset();
});

afterEach(() => {
  resetDb();
});

describe("getBudgetStatus (FR-8.3)", () => {
  it("reports 'ok' when well under the cap", () => {
    recordCost({ provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 1000, outputUnits: 1000, estimatedCostUsd: 1 });

    const status = getBudgetStatus(10);
    expect(status.state).toBe("ok");
    expect(status.fractionUsed).toBeCloseTo(0.1);
  });

  it("reports 'approaching' once spend reaches 80% of the monthly cap", () => {
    recordCost({ provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 1000, outputUnits: 1000, estimatedCostUsd: 8 });

    const status = getBudgetStatus(10);
    expect(status.state).toBe("approaching");
    expect(status.fractionUsed).toBeCloseTo(0.8);
  });

  it("reports 'exceeded' once spend reaches 100% of the monthly cap", () => {
    recordCost({ provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 1000, outputUnits: 1000, estimatedCostUsd: 10 });

    const status = getBudgetStatus(10);
    expect(status.state).toBe("exceeded");
    expect(status.fractionUsed).toBeCloseTo(1);
  });

  it("reports 'exceeded' once spend goes over 100% of the monthly cap", () => {
    recordCost({ provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 1000, outputUnits: 1000, estimatedCostUsd: 15 });

    const status = getBudgetStatus(10);
    expect(status.state).toBe("exceeded");
    expect(status.fractionUsed).toBeGreaterThan(1);
  });

  it("treats a non-positive monthly cap as 'no cap' (always 'ok')", () => {
    recordCost({ provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 1000, outputUnits: 1000, estimatedCostUsd: 1000 });

    const status = getBudgetStatus(0);
    expect(status.state).toBe("ok");
    expect(status.fractionUsed).toBe(0);
  });
});

describe("think() restricted mode at/over the monthly budget cap (FR-8.3)", () => {
  it("when the month's cost ledger total is at or above the cap, returns a stub 'budget exceeded' reply WITHOUT calling the model", async () => {
    const { think } = await import("../core/brain");

    // Push the current month's recorded cost to >= the mocked $10 cap.
    recordCost({ provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 1_000_000, outputUnits: 1_000_000, estimatedCostUsd: 10 });

    const result = await think([{ role: "user", content: "Hi" }], [], undefined);

    expect(result.stub).toBe(true);
    expect(result.text).toMatch(/budget cap reached/i);
    expect(result.text).toMatch(/restricted mode/i);

    // No paid model call was made.
    expect(createMock).not.toHaveBeenCalled();
  });

  it("when under the cap, think() proceeds normally and calls the model", async () => {
    const { think } = await import("../core/brain");

    recordCost({ provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 1000, outputUnits: 1000, estimatedCostUsd: 1 });

    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello there!" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const result = await think([{ role: "user", content: "Hi" }], [], undefined);

    expect(result.stub).toBe(false);
    expect(result.text).toBe("Hello there!");
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

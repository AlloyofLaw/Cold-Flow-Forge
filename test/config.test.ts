import { describe, it, expect } from "vitest";
import {
  loadConfig,
  DEFAULT_MODEL_MAIN,
  DEFAULT_MODEL_ROUTER,
  DEFAULT_MONTHLY_BUDGET_USD,
} from "../config";

describe("config loader", () => {
  it("runs in stub mode (no API key) when ANTHROPIC_API_KEY is unset", () => {
    const cfg = loadConfig({});
    expect(cfg.hasAnthropicApiKey).toBe(false);
    expect(cfg.anthropicApiKey).toBe("");
  });

  it("detects a configured API key", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "sk-test-123" });
    expect(cfg.hasAnthropicApiKey).toBe(true);
    expect(cfg.anthropicApiKey).toBe("sk-test-123");
  });

  it("falls back to documented defaults when unset", () => {
    const cfg = loadConfig({});
    expect(cfg.modelMain).toBe(DEFAULT_MODEL_MAIN);
    expect(cfg.modelRouter).toBe(DEFAULT_MODEL_ROUTER);
    expect(cfg.monthlyBudgetUsd).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(cfg.vaultBackend).toBe("auto");
    expect(cfg.voiceAdapter).toBe("text");
  });

  it("honors overrides from the environment", () => {
    const cfg = loadConfig({
      JARVIS_MODEL_MAIN: "claude-custom-main",
      JARVIS_MODEL_ROUTER: "claude-custom-router",
      JARVIS_MONTHLY_BUDGET_USD: "42",
      JARVIS_VAULT_BACKEND: "file",
      JARVIS_VOICE_ADAPTER: "stub",
    });

    expect(cfg.modelMain).toBe("claude-custom-main");
    expect(cfg.modelRouter).toBe("claude-custom-router");
    expect(cfg.monthlyBudgetUsd).toBe(42);
    expect(cfg.vaultBackend).toBe("file");
    expect(cfg.voiceAdapter).toBe("stub");
  });

  it("ignores invalid numeric budget overrides", () => {
    const cfg = loadConfig({ JARVIS_MONTHLY_BUDGET_USD: "not-a-number" });
    expect(cfg.monthlyBudgetUsd).toBe(DEFAULT_MONTHLY_BUDGET_USD);
  });
});

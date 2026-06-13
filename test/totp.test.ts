import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import fs from "node:fs";
import path from "node:path";

// Force the local-file vault fallback so TOTP secret storage is
// deterministic in headless/CI environments without a Secret Service /
// Keychain daemon (mirrors test/vault.test.ts).
//
// Use a dedicated vault directory for this file (via `vaultDir`) so it never
// shares an on-disk vault file/key with other test files that also use the
// file-vault backend (e.g. test/vault.test.ts) - vitest runs test files in
// parallel by default, and a shared file would race.
//
// NOTE: This file also contains the Tier 3 end-to-end two-factor
// confirmation tests (formerly test/tier3-totp.test.ts), kept together here
// so all TOTP-related tests share one isolated vault directory.
//
// `vi.mock` factories are hoisted above all other statements in the file, so
// the vault directory path is recomputed inline here (and again below for use
// in this file's own cleanup helpers) rather than shared via a top-level
// const.
vi.mock("../config", async () => {
  const path = await import("node:path");
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    config: {
      ...actual.config,
      anthropicApiKey: "test-key",
      hasAnthropicApiKey: true,
      vaultBackend: "file",
      vaultDevPassphrase: "test-passphrase-for-totp-spec",
      vaultDir: path.resolve(__dirname, "..", "data", ".totp-test-vault"),
    },
  };
});

const VAULT_DIR = path.resolve(__dirname, "..", "data", ".totp-test-vault");
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

const VAULT_FILE = path.join(VAULT_DIR, ".jarvis-dev-vault.json");
const VAULT_KEY_FILE = path.join(VAULT_DIR, ".jarvis-dev-vault.key");

function cleanupVaultFiles(): void {
  for (const file of [VAULT_FILE, VAULT_KEY_FILE]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (fs.existsSync(VAULT_DIR)) fs.rmSync(VAULT_DIR, { recursive: true, force: true });
}

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class FakeAnthropic {
      messages = { create: createMock };
    },
  };
});

// A fixture skill with a Tier 3 (financial/irreversible) tool, used to
// exercise the R-2a two-factor confirmation flow without depending on a real
// skill's tier assignments.
const TIER3_SKILL_ID = "tier3-fixture-skill";
const TIER3_TOOL_NAME = "move_real_money";

const tier3ToolHandler = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "money moved!" }],
});

async function registerTier3Skill(): Promise<void> {
  const server = new McpServer({ name: "jarvis-tier3-fixture-skill", version: "0.1.0" });

  server.registerTool(
    TIER3_TOOL_NAME,
    {
      title: "Move real money",
      description: "A Tier 3 tool fixture used to test the R-2a two-factor confirmation flow.",
      inputSchema: {},
    },
    tier3ToolHandler,
  );

  const client = new McpSkillClient(TIER3_SKILL_ID);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();

  skillRegistry.register({
    id: TIER3_SKILL_ID,
    name: "Tier 3 confirmation fixture skill",
    mcpServerRef: "in-process:test/totp.test.ts",
    status: "connected",
    client,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      tier: classifyTool({ skill: TIER3_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS),
    })),
  });
}

function usage(inputTokens = 10, outputTokens = 10) {
  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

/** A fake ConfirmationProvider that records requests, returns a fixed decision, and optionally a TOTP code. */
function fakeProvider(
  decision: ConfirmationDecision,
  totpCode?: string,
): ConfirmationProvider & { requests: ConfirmationRequest[] } {
  const requests: ConfirmationRequest[] = [];
  return {
    requests,
    async requestConfirmation(request) {
      requests.push(request);
      return decision;
    },
    async getTotpCode() {
      return totpCode;
    },
  };
}

function mockToolCallThenReply(toolName: string, replyText: string, input: Record<string, unknown> = {}): void {
  createMock.mockResolvedValueOnce({
    content: [
      {
        type: "tool_use",
        id: "toolu_tier3",
        name: toolName,
        input,
      },
    ],
    usage: usage(),
  });
  createMock.mockResolvedValueOnce({
    content: [{ type: "text", text: replyText }],
    usage: usage(),
  });
}

beforeEach(() => {
  cleanupVaultFiles();
});

afterEach(() => {
  cleanupVaultFiles();
});

describe("TOTP second factor (R-2a, SEC-6)", () => {
  it("is NOT configured before setup, and verification fails closed", async () => {
    const { isTotpConfigured, verifyTotpCode } = await import("../security/totp");

    expect(await isTotpConfigured()).toBe(false);
    expect(await verifyTotpCode("123456")).toBe(false);
    expect(await verifyTotpCode("")).toBe(false);
  });

  it("generateTotpSecret produces a base32 secret and an otpauth:// setup URI, and persists the secret", async () => {
    const { generateTotpSecret, isTotpConfigured } = await import("../security/totp");

    const setup = await generateTotpSecret();

    expect(setup.secret.length).toBeGreaterThan(0);
    // Base32 alphabet only.
    expect(setup.secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.uri).toContain(setup.secret);
    expect(setup.uri).toContain("JARVIS");

    expect(await isTotpConfigured()).toBe(true);
  });

  it("verifies a code computed with the same library against the stored secret (round-trip)", async () => {
    const { generateTotpSecret, verifyTotpCode, generateTotpCode } = await import("../security/totp");

    const setup = await generateTotpSecret();
    const validCode = await generateTotpCode(setup.secret);

    expect(await verifyTotpCode(validCode)).toBe(true);
  });

  it("rejects a wrong/stale code", async () => {
    const { generateTotpSecret, verifyTotpCode, generateTotpCode } = await import("../security/totp");

    const setup = await generateTotpSecret();
    const validCode = await generateTotpCode(setup.secret);

    // A code that's definitely not the valid one (increment each digit mod 10).
    const wrongCode = validCode
      .split("")
      .map((d) => String((Number(d) + 1) % 10))
      .join("");

    expect(await verifyTotpCode(wrongCode)).toBe(false);
    expect(await verifyTotpCode("000000")).toBe(wrongCode === "000000" ? false : await verifyTotpCode("000000"));
    expect(await verifyTotpCode("not-a-code")).toBe(false);
  });

  it("re-running setup generates a new secret that invalidates codes from the old one", async () => {
    const { generateTotpSecret, verifyTotpCode, generateTotpCode } = await import("../security/totp");

    const firstSetup = await generateTotpSecret();
    const firstCode = await generateTotpCode(firstSetup.secret);

    const secondSetup = await generateTotpSecret();
    expect(secondSetup.secret).not.toBe(firstSetup.secret);

    // The old code (for the old secret) should not validate against the new secret,
    // unless of course they happen to collide (astronomically unlikely).
    const validNow = await verifyTotpCode(firstCode);
    const newCode = await generateTotpCode(secondSetup.secret);
    if (firstCode !== newCode) {
      expect(validNow).toBe(false);
    }
  });
});

describe("Tier 3 two-factor enforcement in the confirmation flow (R-2a)", () => {
  it("shouldProceedAfterConfirmation requires BOTH approved decision AND totpVerified for Tier 3", async () => {
    const { shouldProceedAfterConfirmation, PermissionTier } = await import("../core/permissions");

    // Approved but no TOTP -> does not proceed.
    expect(shouldProceedAfterConfirmation(PermissionTier.FinancialOrIrreversible, "approved", false)).toBe(false);
    expect(shouldProceedAfterConfirmation(PermissionTier.FinancialOrIrreversible, "approved", undefined)).toBe(false);

    // Approved AND TOTP verified -> proceeds.
    expect(shouldProceedAfterConfirmation(PermissionTier.FinancialOrIrreversible, "approved", true)).toBe(true);

    // Denied, regardless of TOTP -> never proceeds.
    expect(shouldProceedAfterConfirmation(PermissionTier.FinancialOrIrreversible, "denied", true)).toBe(false);

    // Tier 2 is unaffected by the totpVerified argument.
    expect(shouldProceedAfterConfirmation(PermissionTier.ExternalOrHardToReverse, "approved", false)).toBe(true);
  });

  it("assertTierThreeTwoFactorSatisfied throws unless both factors are present", async () => {
    const { assertTierThreeTwoFactorSatisfied, PermissionTier } = await import("../core/permissions");

    expect(() => assertTierThreeTwoFactorSatisfied(PermissionTier.FinancialOrIrreversible, "approved", false)).toThrow();
    expect(() => assertTierThreeTwoFactorSatisfied(PermissionTier.FinancialOrIrreversible, "denied", true)).toThrow();
    expect(() => assertTierThreeTwoFactorSatisfied(PermissionTier.FinancialOrIrreversible, "approved", true)).not.toThrow();

    // No-op for non-Tier-3.
    expect(() => assertTierThreeTwoFactorSatisfied(PermissionTier.ExternalOrHardToReverse, "denied", false)).not.toThrow();
  });
});

describe("Tier 3 two-factor confirmation end-to-end (R-2a, SEC-6)", () => {
  beforeEach(() => {
    resetDb();
    getDb(":memory:");
    createMock.mockReset();
    tier3ToolHandler.mockClear();
    setPauseModeOverride(undefined);
    cleanupVaultFiles();

    // Force this fixture tool to Tier 3 via TIER_ASSIGNMENTS.
    TIER_ASSIGNMENTS[TIER3_SKILL_ID] = {
      [TIER3_TOOL_NAME]: PermissionTier.FinancialOrIrreversible,
    };
  });

  afterEach(() => {
    resetDb();
    skillRegistry.unregister(TIER3_SKILL_ID);
    setPauseModeOverride(undefined);
    delete TIER_ASSIGNMENTS[TIER3_SKILL_ID];
    cleanupVaultFiles();
  });

  it("requests confirmation with requiresTotp=true for a Tier 3 tool", async () => {
    await registerTier3Skill();
    const { handleUserMessage, createSessionId } = await import("../core/agent");

    mockToolCallThenReply(`${TIER3_SKILL_ID}__${TIER3_TOOL_NAME}`, "I can't do that without two-factor.");

    const provider = fakeProvider("approved", undefined);
    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "Move the money", provider);

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].tier).toBe(PermissionTier.FinancialOrIrreversible);
    expect(provider.requests[0].requiresTotp).toBe(true);
  });

  it("confirmed but with NO TOTP set up at all -> does NOT execute, and explains setup is required", async () => {
    await registerTier3Skill();
    const { handleUserMessage, createSessionId } = await import("../core/agent");

    mockToolCallThenReply(`${TIER3_SKILL_ID}__${TIER3_TOOL_NAME}`, "Two-factor isn't set up yet.");

    const provider = fakeProvider("approved", "123456");
    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "Move the money", provider);

    expect(tier3ToolHandler).not.toHaveBeenCalled();

    const activity = listRecentActivity(10);
    const entry = activity.find((e) => e.tool === TIER3_TOOL_NAME);
    expect(entry?.outcome).toBe("denied");
    expect(entry?.summary).toMatch(/two-factor/i);
  });

  it("confirmed with TOTP set up but an INVALID code -> does NOT execute", async () => {
    await registerTier3Skill();
    const { generateTotpSecret } = await import("../security/totp");
    await generateTotpSecret();

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    mockToolCallThenReply(`${TIER3_SKILL_ID}__${TIER3_TOOL_NAME}`, "That code didn't work.");

    const provider = fakeProvider("approved", "000000");
    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "Move the money", provider);

    expect(tier3ToolHandler).not.toHaveBeenCalled();

    const activity = listRecentActivity(10);
    const entry = activity.find((e) => e.tool === TIER3_TOOL_NAME);
    expect(entry?.outcome).toBe("denied");
  });

  it("confirmed with NO code provided (TOTP configured) -> does NOT execute", async () => {
    await registerTier3Skill();
    const { generateTotpSecret } = await import("../security/totp");
    await generateTotpSecret();

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    mockToolCallThenReply(`${TIER3_SKILL_ID}__${TIER3_TOOL_NAME}`, "No code provided.");

    const provider = fakeProvider("approved", undefined);
    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "Move the money", provider);

    expect(tier3ToolHandler).not.toHaveBeenCalled();
  });

  it("confirmed AND a valid TOTP code -> executes", async () => {
    await registerTier3Skill();
    const { generateTotpSecret, generateTotpCode } = await import("../security/totp");
    const setup = await generateTotpSecret();
    const validCode = await generateTotpCode(setup.secret);

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    mockToolCallThenReply(`${TIER3_SKILL_ID}__${TIER3_TOOL_NAME}`, "Done - money moved.");

    const provider = fakeProvider("approved", validCode);
    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Move the money", provider);

    expect(response.reply).toBe("Done - money moved.");
    expect(tier3ToolHandler).toHaveBeenCalledTimes(1);

    const activity = listRecentActivity(10);
    const ranEntry = activity.find((e) => e.tool === TIER3_TOOL_NAME && e.summary?.startsWith("Ran"));
    expect(ranEntry).toBeDefined();
    expect(ranEntry?.outcome).toBe("success");
  });

  it("a 'denied' decision never executes, even with a valid TOTP code (R-1)", async () => {
    await registerTier3Skill();
    const { generateTotpSecret, generateTotpCode } = await import("../security/totp");
    const setup = await generateTotpSecret();
    const validCode = await generateTotpCode(setup.secret);

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    mockToolCallThenReply(`${TIER3_SKILL_ID}__${TIER3_TOOL_NAME}`, "Okay, cancelled.");

    const provider = fakeProvider("denied", validCode);
    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "Move the money", provider);

    expect(tier3ToolHandler).not.toHaveBeenCalled();
  });
});

describe("stripe.refund_charge end-to-end requires confirm AND valid TOTP (FR-5.3, R-2a)", () => {
  beforeEach(() => {
    resetDb();
    getDb(":memory:");
    createMock.mockReset();
    setPauseModeOverride(undefined);
    cleanupVaultFiles();
  });

  afterEach(() => {
    resetDb();
    skillRegistry.unregister("stripe");
    setPauseModeOverride(undefined);
    cleanupVaultFiles();
  });

  async function registerStripeStub(): Promise<void> {
    vi.doMock("../config", async () => {
      const path = await import("node:path");
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: {
          ...actual.config,
          anthropicApiKey: "test-key",
          hasAnthropicApiKey: true,
          vaultBackend: "file",
          vaultDevPassphrase: "test-passphrase-for-totp-spec",
          vaultDir: path.resolve(__dirname, "..", "data", ".totp-test-vault"),
          stripeApiKey: "",
          hasStripeApiKey: false,
          stripeAllowLiveMode: false,
        },
      };
    });

    const { registerStripeSkill } = await import("../skills/stripe");
    await registerStripeSkill();
  }

  it("refund_charge does NOT execute without a valid TOTP code, even when confirmed", async () => {
    await registerStripeStub();
    const { handleUserMessage, createSessionId } = await import("../core/agent");

    mockToolCallThenReply("stripe__refund_charge", "I can't refund that yet.", { chargeId: "ch_123" });

    const provider = fakeProvider("approved", undefined);
    const sessionId = createSessionId();
    await handleUserMessage(sessionId, "Refund charge ch_123", provider);

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].tier).toBe(PermissionTier.FinancialOrIrreversible);
    expect(provider.requests[0].requiresTotp).toBe(true);
    expect(provider.requests[0].description).toMatch(/cannot be undone/i);

    const activity = listRecentActivity(10);
    const entry = activity.find((e) => e.tool === "refund_charge");
    expect(entry?.outcome).toBe("denied");
  });

  it("refund_charge executes ONLY with BOTH an approved confirmation AND a valid TOTP code", async () => {
    await registerStripeStub();
    const { generateTotpSecret, generateTotpCode } = await import("../security/totp");
    const setup = await generateTotpSecret();
    const validCode = await generateTotpCode(setup.secret);

    const { handleUserMessage, createSessionId } = await import("../core/agent");

    mockToolCallThenReply("stripe__refund_charge", "Refund issued.", { chargeId: "ch_789" });

    const provider = fakeProvider("approved", validCode);
    const sessionId = createSessionId();
    const response = await handleUserMessage(sessionId, "Refund the full amount of charge ch_789", provider);

    expect(response.reply).toBe("Refund issued.");

    const activity = listRecentActivity(10);
    const ranEntry = activity.find((e) => e.tool === "refund_charge" && e.summary?.startsWith("Ran"));
    expect(ranEntry).toBeDefined();
    expect(ranEntry?.outcome).toBe("success");
    expect(ranEntry?.tier).toBe(PermissionTier.FinancialOrIrreversible);
  });
});

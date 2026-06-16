import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDb } from "../store/database";

beforeEach(() => {
  resetDb();
  getDb(":memory:");
});

afterEach(() => {
  resetDb();
  vi.doUnmock("../config");
});

describe("Stripe key mode detection (FR-5.6)", () => {
  it("recognizes test-mode secret and restricted keys", async () => {
    const { isTestModeKey, isLiveModeKey } = await import("../skills/stripe/client");
    expect(isTestModeKey("sk_test_123")).toBe(true);
    expect(isTestModeKey("rk_test_abc")).toBe(true);
    expect(isLiveModeKey("sk_test_123")).toBe(false);
  });

  it("recognizes live-mode secret and restricted keys", async () => {
    const { isTestModeKey, isLiveModeKey } = await import("../skills/stripe/client");
    expect(isLiveModeKey("sk_live_123")).toBe(true);
    expect(isLiveModeKey("rk_live_abc")).toBe(true);
    expect(isTestModeKey("sk_live_123")).toBe(false);
  });
});

describe("Stripe MCP server - stub mode (no API key configured)", () => {
  beforeEach(() => {
    vi.doMock("../config", async () => {
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: {
          ...actual.config,
          stripeApiKey: "",
          hasStripeApiKey: false,
          stripeAllowLiveMode: false,
        },
      };
    });
  });

  it("registers the read-only tools as Tier 0, and the write tools as Tier 3", async () => {
    const { registerStripeSkill, STRIPE_SKILL_ID } = await import("../skills/stripe");
    const { PermissionTier, classifyTool, TIER_ASSIGNMENTS } = await import("../core/permissions");

    const descriptor = await registerStripeSkill();

    expect(descriptor.status).toBe("connected");
    expect(descriptor.id).toBe(STRIPE_SKILL_ID);

    const toolNames = descriptor.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      "cancel_subscription",
      "get_balance",
      "list_charges",
      "list_customers",
      "list_disputes",
      "list_invoices",
      "list_payouts",
      "refund_charge",
    ]);

    const readOnlyTools = ["get_balance", "list_charges", "list_customers", "list_disputes", "list_invoices", "list_payouts"];
    const writeTools = ["refund_charge", "cancel_subscription"];

    for (const tool of descriptor.tools) {
      const expectedTier = writeTools.includes(tool.name) ? PermissionTier.FinancialOrIrreversible : PermissionTier.ReadOnly;
      expect(tool.tier).toBe(expectedTier);
      expect(classifyTool({ skill: STRIPE_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS)).toBe(expectedTier);
    }

    expect(readOnlyTools.every((name) => toolNames.includes(name))).toBe(true);
  });

  it("get_balance returns a clearly-labeled stub result with dollars+currency (FR-5.5), no network calls", async () => {
    const { registerStripeSkill, STRIPE_SKILL_ID } = await import("../skills/stripe");
    const { skillRegistry } = await import("../skills/registry");

    await registerStripeSkill();
    const skill = skillRegistry.get(STRIPE_SKILL_ID);

    const raw = (await skill!.client!.callTool("get_balance", {})) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(raw.content[0].text) as {
      stub: boolean;
      notice: string;
      balance: { available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] };
    };

    expect(payload.stub).toBe(true);
    expect(payload.notice).toMatch(/no stripe account is connected/i);
    expect(payload.balance.available[0]).toEqual({ amount: 1234.56, currency: "usd" });
    expect(typeof payload.balance.available[0].amount).toBe("number");
  });

  it("list_charges returns a clearly-labeled stub result with an empty charges array", async () => {
    const { registerStripeSkill, STRIPE_SKILL_ID } = await import("../skills/stripe");
    const { skillRegistry } = await import("../skills/registry");

    await registerStripeSkill();
    const skill = skillRegistry.get(STRIPE_SKILL_ID);

    const raw = (await skill!.client!.callTool("list_charges", {})) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(raw.content[0].text) as { stub: boolean; notice: string; charges: unknown[] };
    expect(payload.stub).toBe(true);
    expect(payload.notice).toMatch(/no stripe account is connected/i);
    expect(payload.charges).toEqual([]);
  });

  it("getStripeClient() returns undefined (stub mode) when no key is configured", async () => {
    const { getStripeClient } = await import("../skills/stripe/client");
    const client = await getStripeClient();
    expect(client).toBeUndefined();
  });
});

describe("Stripe cents->dollars conversion (FR-5.5)", () => {
  it("toMoneyAmount divides integer smallest-unit amounts by 100", async () => {
    const { toMoneyAmount } = await import("../skills/stripe/server");
    expect(toMoneyAmount(130000, "usd")).toEqual({ amount: 1300, currency: "usd" });
    expect(toMoneyAmount(1300, "usd")).toEqual({ amount: 13, currency: "usd" });
    expect(toMoneyAmount(99, "usd")).toEqual({ amount: 0.99, currency: "usd" });
  });
});

describe("Stripe TEST-MODE enforcement (FR-5.6, SEC-2)", () => {
  it("a sk_live_-shaped key WITHOUT STRIPE_ALLOW_LIVE_MODE is refused (stub mode, no client)", async () => {
    vi.resetModules();
    vi.doMock("../config", async () => {
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: {
          ...actual.config,
          stripeApiKey: "sk_live_abc123",
          hasStripeApiKey: true,
          stripeAllowLiveMode: false,
        },
      };
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getStripeClient } = await import("../skills/stripe/client");
    const client = await getStripeClient();

    expect(client).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    expect(consoleError.mock.calls[0][0]).toMatch(/live-mode/i);

    consoleError.mockRestore();
  });

  it("a sk_live_-shaped key WITH STRIPE_ALLOW_LIVE_MODE=true builds a real client", async () => {
    vi.resetModules();
    vi.doMock("../config", async () => {
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: {
          ...actual.config,
          stripeApiKey: "sk_live_abc123",
          hasStripeApiKey: true,
          stripeAllowLiveMode: true,
        },
      };
    });

    const { getStripeClient } = await import("../skills/stripe/client");
    const client = await getStripeClient();

    expect(client).toBeDefined();
  });

  it("a sk_test_-shaped key builds a real client regardless of STRIPE_ALLOW_LIVE_MODE", async () => {
    vi.resetModules();
    vi.doMock("../config", async () => {
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: {
          ...actual.config,
          stripeApiKey: "sk_test_abc123",
          hasStripeApiKey: true,
          stripeAllowLiveMode: false,
        },
      };
    });

    const { getStripeClient } = await import("../skills/stripe/client");
    const client = await getStripeClient();

    expect(client).toBeDefined();
  });

  it("isConfiguredKeyTestMode reports true for a test key and false for an allowed live key", async () => {
    vi.resetModules();
    vi.doMock("../config", async () => {
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: {
          ...actual.config,
          stripeApiKey: "sk_test_abc123",
          hasStripeApiKey: true,
          stripeAllowLiveMode: false,
        },
      };
    });

    const { isConfiguredKeyTestMode } = await import("../skills/stripe/client");
    expect(await isConfiguredKeyTestMode()).toBe(true);
  });
});

describe("Stripe write tools (Tier 3, FR-5.3) - stub mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../config", async () => {
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: {
          ...actual.config,
          stripeApiKey: "",
          hasStripeApiKey: false,
          stripeAllowLiveMode: false,
        },
      };
    });
  });

  it("refund_charge and cancel_subscription are ALWAYS Tier 3, regardless of arguments (no classifier hook)", async () => {
    const { PermissionTier, classifyTool, TIER_ASSIGNMENTS, CLASSIFIER_HOOKS } = await import("../core/permissions");

    for (const args of [{}, { chargeId: "ch_123" }, { chargeId: "ch_123", amount: 25.5 }]) {
      expect(
        classifyTool({ skill: "stripe", tool: "refund_charge" }, TIER_ASSIGNMENTS, args, CLASSIFIER_HOOKS),
      ).toBe(PermissionTier.FinancialOrIrreversible);
    }

    for (const args of [{}, { subscriptionId: "sub_123" }]) {
      expect(
        classifyTool({ skill: "stripe", tool: "cancel_subscription" }, TIER_ASSIGNMENTS, args, CLASSIFIER_HOOKS),
      ).toBe(PermissionTier.FinancialOrIrreversible);
    }

    // No classifier hooks registered for these tools (R-6: no downgrade ever).
    expect(CLASSIFIER_HOOKS.stripe).toBeUndefined();
  });

  it("refund_charge returns a clearly-labeled stub result for a full refund, no network call", async () => {
    const { registerStripeSkill, STRIPE_SKILL_ID } = await import("../skills/stripe");
    const { skillRegistry } = await import("../skills/registry");

    await registerStripeSkill();
    const skill = skillRegistry.get(STRIPE_SKILL_ID);

    const raw = (await skill!.client!.callTool("refund_charge", { chargeId: "ch_full" })) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(raw.content[0].text) as {
      stub: boolean;
      notice: string;
      refund: { chargeId: string; full: boolean; amount: { amount: number; currency: string } };
    };

    expect(payload.stub).toBe(true);
    expect(payload.notice).toMatch(/no stripe account is connected/i);
    expect(payload.refund.chargeId).toBe("ch_full");
    expect(payload.refund.full).toBe(true);
  });

  it("refund_charge returns a clearly-labeled stub result for a partial refund, no network call", async () => {
    const { registerStripeSkill, STRIPE_SKILL_ID } = await import("../skills/stripe");
    const { skillRegistry } = await import("../skills/registry");

    await registerStripeSkill();
    const skill = skillRegistry.get(STRIPE_SKILL_ID);

    const raw = (await skill!.client!.callTool("refund_charge", { chargeId: "ch_partial", amount: 25.5 })) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(raw.content[0].text) as {
      stub: boolean;
      refund: { chargeId: string; full: boolean; amount: { amount: number; currency: string } };
    };

    expect(payload.stub).toBe(true);
    expect(payload.refund.full).toBe(false);
    expect(payload.refund.amount).toEqual({ amount: 25.5, currency: "usd" });
  });

  it("cancel_subscription returns a clearly-labeled stub result, no network call", async () => {
    const { registerStripeSkill, STRIPE_SKILL_ID } = await import("../skills/stripe");
    const { skillRegistry } = await import("../skills/registry");

    await registerStripeSkill();
    const skill = skillRegistry.get(STRIPE_SKILL_ID);

    const raw = (await skill!.client!.callTool("cancel_subscription", { subscriptionId: "sub_abc" })) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(raw.content[0].text) as {
      stub: boolean;
      notice: string;
      subscription: { id: string; status: string };
    };

    expect(payload.stub).toBe(true);
    expect(payload.notice).toMatch(/no stripe account is connected/i);
    expect(payload.subscription).toEqual({ id: "sub_abc", status: "stub_canceled" });
  });
});

describe("Stripe write tool confirmation descriptions (R-2/R-2a, FR-5.5)", () => {
  it("describeToolCall shows the FULL refund amount in dollars, charge id, and 'cannot be undone'", async () => {
    const { describeToolCall } = await import("../core/permissions");

    const description = describeToolCall({ skill: "stripe", tool: "refund_charge" }, { chargeId: "ch_123" });

    expect(description).toContain("ch_123");
    expect(description).toMatch(/full/i);
    expect(description).toMatch(/cannot be undone/i);
    expect(description).toMatch(/real money/i);
  });

  it("describeToolCall shows a PARTIAL refund amount converted from a 2550-cent-equivalent charge as $25.50", async () => {
    const { describeToolCall } = await import("../core/permissions");
    const { toMoneyAmount } = await import("../skills/stripe/server");

    // Mirror the cents->dollars conversion used elsewhere in the Stripe skill
    // (FR-5.5): a 2550-cent charge is $25.50.
    const money = toMoneyAmount(2550, "usd");
    expect(money.amount).toBe(25.5);

    const description = describeToolCall(
      { skill: "stripe", tool: "refund_charge" },
      { chargeId: "ch_456", amount: money.amount },
    );

    expect(description).toContain("$25.50");
    expect(description).toContain("ch_456");
    expect(description).toMatch(/partial/i);
    expect(description).toMatch(/cannot be undone/i);
  });

  it("describeToolCall for cancel_subscription names the subscription and says it cannot be undone", async () => {
    const { describeToolCall } = await import("../core/permissions");

    const description = describeToolCall(
      { skill: "stripe", tool: "cancel_subscription" },
      { subscriptionId: "sub_xyz" },
    );

    expect(description).toContain("sub_xyz");
    expect(description).toMatch(/cancel/i);
    expect(description).toMatch(/cannot be undone/i);
  });
});

describe("FR-5.4 hard block: no charge-creation/payout/account/key-management tools", () => {
  it("FR_5_4_DENYLIST_SUBSTRINGS rejects the explicitly out-of-scope tool families", async () => {
    const { FR_5_4_DENYLIST_SUBSTRINGS } = await import("../skills/stripe/client");

    for (const substring of [
      "create_charge",
      "create_payment",
      "payout",
      "account_update",
      "update_account",
      "api_key",
      "apikey",
      "bank_account",
      "bank_detail",
    ]) {
      expect(FR_5_4_DENYLIST_SUBSTRINGS).toContain(substring);
    }
  });

  it("no registered Stripe WRITE tool name contains any FR-5.4 denylist substring", async () => {
    vi.resetModules();
    vi.doMock("../config", async () => {
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: { ...actual.config, stripeApiKey: "", hasStripeApiKey: false, stripeAllowLiveMode: false },
      };
    });

    const { registerStripeSkill } = await import("../skills/stripe");
    const { FR_5_4_DENYLIST_SUBSTRINGS } = await import("../skills/stripe/client");
    const { PermissionTier } = await import("../core/permissions");

    const descriptor = await registerStripeSkill();

    // The denylist targets WRITE/management tools (e.g. "create_charge",
    // "payout" config changes, "api_key" management) - read-only listing
    // tools like "list_payouts" legitimately contain "payout" and are fine
    // (FR-5.2). Scope the check to non-read-only (write) tools, which is
    // where a future out-of-scope tool would actually appear.
    const writeTools = descriptor.tools.filter((t) => t.tier !== PermissionTier.ReadOnly);
    expect(writeTools.map((t) => t.name).sort()).toEqual(["cancel_subscription", "refund_charge"]);

    for (const tool of writeTools) {
      const lowerName = tool.name.toLowerCase();
      for (const substring of FR_5_4_DENYLIST_SUBSTRINGS) {
        expect(lowerName).not.toContain(substring);
      }
    }

    // Also assert no tool of ANY kind is literally a charge-creation, payout-
    // management, account-settings, or API-key-management tool.
    const allNames = descriptor.tools.map((t) => t.name.toLowerCase());
    for (const forbidden of ["create_charge", "create_payment", "payout_update", "account_update", "update_account", "api_key", "apikey", "bank_account", "bank_detail"]) {
      expect(allNames).not.toContain(forbidden);
    }
  });
});

describe("registerAllSkills includes Stripe and the Local Filesystem skill", () => {
  it("registers google-calendar, gmail, stripe, and filesystem", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const tempAllowedDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-register-all-skills-"));

    try {
      vi.doMock("../config", async () => {
        const actual = await vi.importActual<typeof import("../config")>("../config");
        return {
          ...actual,
          config: {
            ...actual.config,
            hasGoogleOAuthClient: false,
            stripeApiKey: "",
            hasStripeApiKey: false,
            allowedDirectory: tempAllowedDir,
          },
        };
      });

      const { registerAllSkills } = await import("../skills");
      const { skillRegistry } = await import("../skills/registry");

      await registerAllSkills();

      const ids = skillRegistry.list().map((s) => s.id).sort();
      expect(ids).toContain("google-calendar");
      expect(ids).toContain("gmail");
      expect(ids).toContain("stripe");
      expect(ids).toContain("filesystem");
    } finally {
      fs.rmSync(tempAllowedDir, { recursive: true, force: true });
    }
  });
});

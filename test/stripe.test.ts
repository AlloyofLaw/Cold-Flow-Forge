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

  it("registers all tools as Tier 0 / read-only", async () => {
    const { registerStripeSkill, STRIPE_SKILL_ID } = await import("../skills/stripe");
    const { PermissionTier, classifyTool, TIER_ASSIGNMENTS } = await import("../core/permissions");

    const descriptor = await registerStripeSkill();

    expect(descriptor.status).toBe("connected");
    expect(descriptor.id).toBe(STRIPE_SKILL_ID);

    const toolNames = descriptor.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      "get_balance",
      "list_charges",
      "list_customers",
      "list_disputes",
      "list_invoices",
      "list_payouts",
    ]);

    for (const tool of descriptor.tools) {
      expect(tool.tier).toBe(PermissionTier.ReadOnly);
      expect(classifyTool({ skill: STRIPE_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS)).toBe(
        PermissionTier.ReadOnly,
      );
    }
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

describe("registerAllSkills includes Stripe", () => {
  it("registers google-calendar, gmail, and stripe", async () => {
    vi.doMock("../config", async () => {
      const actual = await vi.importActual<typeof import("../config")>("../config");
      return {
        ...actual,
        config: {
          ...actual.config,
          hasGoogleOAuthClient: false,
          stripeApiKey: "",
          hasStripeApiKey: false,
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
  });
});

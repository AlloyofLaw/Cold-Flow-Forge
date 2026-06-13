import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDb, resetDb } from "../store/database";

// No Google OAuth client configured -> the calendar skill must run entirely
// in stub mode (PRD Phase 1 "Graceful stub mode"): it registers successfully,
// and its tools return clearly-labeled placeholder data without making any
// network calls.
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    config: {
      ...actual.config,
      googleOAuthClientId: "",
      googleOAuthClientSecret: "",
      hasGoogleOAuthClient: false,
      timeZone: "America/New_York",
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

describe("Google Calendar skill - read-only scope", () => {
  it("only ever requests the calendar.readonly scope", async () => {
    const { CALENDAR_READONLY_SCOPE } = await import("../skills/google-calendar/auth");
    expect(CALENDAR_READONLY_SCOPE).toBe("https://www.googleapis.com/auth/calendar.readonly");
  });

  it("getCalendarAuth() returns undefined when no OAuth client is configured (stub mode)", async () => {
    const { getCalendarAuth } = await import("../skills/google-calendar/auth");
    const auth = await getCalendarAuth();
    expect(auth).toBeUndefined();
  });

  it("getAuthorizationUrl() returns undefined when no OAuth client is configured (stub mode)", async () => {
    const { getAuthorizationUrl } = await import("../skills/google-calendar/auth");
    expect(getAuthorizationUrl()).toBeUndefined();
  });
});

describe("Google Calendar MCP server - stub mode (no account connected)", () => {
  it("registers list_calendars and list_events, both Tier 0 (read-only)", async () => {
    const { registerGoogleCalendarSkill, GOOGLE_CALENDAR_SKILL_ID } = await import("../skills/google-calendar");
    const { PermissionTier } = await import("../core/permissions");

    const descriptor = await registerGoogleCalendarSkill();

    expect(descriptor.status).toBe("connected");
    expect(descriptor.id).toBe(GOOGLE_CALENDAR_SKILL_ID);

    const toolNames = descriptor.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(["list_calendars", "list_events"]);

    for (const tool of descriptor.tools) {
      expect(tool.tier).toBe(PermissionTier.ReadOnly);
    }
  });

  it("list_calendars returns a clearly-labeled stub result with no real data", async () => {
    const { registerGoogleCalendarSkill, GOOGLE_CALENDAR_SKILL_ID } = await import("../skills/google-calendar");
    const { skillRegistry } = await import("../skills/registry");

    await registerGoogleCalendarSkill();
    const skill = skillRegistry.get(GOOGLE_CALENDAR_SKILL_ID);
    expect(skill?.client).toBeDefined();

    const raw = (await skill!.client!.callTool("list_calendars", {})) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(raw.content[0].text) as { stub: boolean; notice: string; calendars: unknown[] };
    expect(payload.stub).toBe(true);
    expect(payload.notice).toMatch(/no google calendar account is connected/i);
    expect(payload.calendars).toEqual([]);
  });

  it("list_events returns a clearly-labeled stub result defaulting to today's range in the configured time zone", async () => {
    const { registerGoogleCalendarSkill, GOOGLE_CALENDAR_SKILL_ID } = await import("../skills/google-calendar");
    const { skillRegistry } = await import("../skills/registry");
    const { todayRangeInTimeZone } = await import("../skills/google-calendar/server");

    await registerGoogleCalendarSkill();
    const skill = skillRegistry.get(GOOGLE_CALENDAR_SKILL_ID);

    const raw = (await skill!.client!.callTool("list_events", {})) as {
      content: Array<{ type: string; text: string }>;
    };

    const payload = JSON.parse(raw.content[0].text) as {
      stub: boolean;
      notice: string;
      timeZone: string;
      range: { timeMin: string; timeMax: string };
      events: unknown[];
    };

    expect(payload.stub).toBe(true);
    expect(payload.notice).toMatch(/no google calendar account is connected/i);
    expect(payload.events).toEqual([]);
    expect(payload.timeZone).toBe("America/New_York");

    const expectedRange = todayRangeInTimeZone("America/New_York");
    expect(payload.range.timeMin).toBe(expectedRange.start);
    expect(payload.range.timeMax).toBe(expectedRange.end);
  });
});

describe("resolveTimeRange / todayRangeInTimeZone (FR-3.5)", () => {
  it("passes through an explicit timeMin/timeMax unchanged", async () => {
    const { resolveTimeRange } = await import("../skills/google-calendar/server");

    const range = resolveTimeRange("2026-06-01T00:00:00-04:00", "2026-06-02T00:00:00-04:00", "America/New_York");
    expect(range).toEqual({ timeMin: "2026-06-01T00:00:00-04:00", timeMax: "2026-06-02T00:00:00-04:00" });
  });

  it("defaults to today's full range (00:00:00-23:59:59) in the given time zone, with a correct UTC offset", async () => {
    const { todayRangeInTimeZone } = await import("../skills/google-calendar/server");

    const { start, end, date } = todayRangeInTimeZone("America/New_York");

    // America/New_York is either -04:00 (EDT) or -05:00 (EST) depending on
    // the time of year - assert the shape and that start/end share an offset
    // rather than hardcoding a season-dependent value.
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00[+-]\d{2}:\d{2}$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59[+-]\d{2}:\d{2}$/);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const startOffset = start.slice(-6);
    const endOffset = end.slice(-6);
    expect(["-04:00", "-05:00"]).toContain(startOffset);
    expect(endOffset).toBe(startOffset);
  });

  it("computes a different offset for a different time zone", async () => {
    const { todayRangeInTimeZone } = await import("../skills/google-calendar/server");

    const tokyo = todayRangeInTimeZone("Asia/Tokyo");

    // Asia/Tokyo does not observe daylight saving time - always +09:00.
    expect(tokyo.start.endsWith("+09:00")).toBe(true);
    expect(tokyo.end.endsWith("+09:00")).toBe(true);
  });
});

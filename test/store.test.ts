import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JarvisDatabase } from "../store/database";
import { SCHEMA_SQL } from "../store/schema";
import { recordActivity, listRecentActivity } from "../store/activityLog";
import { recordMessage, getSessionMessages, listRecentMessages } from "../store/conversations";
import { setMemory, getMemory, listMemory, deleteMemory } from "../store/memory";
import {
  recordCost,
  getCurrentMonthCost,
  getTodayCost,
  listRecentCosts,
} from "../store/costLedger";
import { getSetting, setSetting, getSettingJson, setSettingJson, getAllSettings } from "../store/settings";
import { PermissionTier } from "../core/permissions";

let db: JarvisDatabase;

beforeEach(() => {
  db = new JarvisDatabase(":memory:");
  db.exec(SCHEMA_SQL);
});

afterEach(() => {
  db.close();
});

describe("schema bootstrap", () => {
  it("creates all required tables", () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((row: any) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining(["activity_log", "conversations", "cost_ledger", "memory", "settings"]),
    );
  });
});

describe("activity_log", () => {
  it("records and lists entries, newest first", () => {
    recordActivity(
      { skill: "core", tool: "chat", tier: PermissionTier.ReadOnly, outcome: "success", summary: "first" },
      db,
    );
    recordActivity(
      { skill: "core", tool: "ping", tier: PermissionTier.ReadOnly, outcome: "success", summary: "second" },
      db,
    );

    const entries = listRecentActivity(10, db);
    expect(entries).toHaveLength(2);
    expect(entries[0].summary).toBe("second");
    expect(entries[1].summary).toBe("first");
    expect(entries[0].tier).toBe(PermissionTier.ReadOnly);
  });

  it("round-trips JSON params and results", () => {
    recordActivity(
      {
        skill: "core",
        tool: "chat",
        tier: PermissionTier.ReadOnly,
        params: { message: "hello" },
        result: { reply: "world" },
        outcome: "success",
      },
      db,
    );

    const [entry] = listRecentActivity(1, db);
    expect(entry.params).toEqual({ message: "hello" });
    expect(entry.result).toEqual({ reply: "world" });
  });
});

describe("conversations", () => {
  it("stores and retrieves messages for a session in order", () => {
    recordMessage("session-1", "user", "hello", db);
    recordMessage("session-1", "assistant", "hi there", db);
    recordMessage("session-2", "user", "different session", db);

    const messages = getSessionMessages("session-1", db);
    expect(messages.map((m) => m.content)).toEqual(["hello", "hi there"]);
  });

  it("lists recent messages across sessions, newest first", () => {
    recordMessage("session-1", "user", "first", db);
    recordMessage("session-2", "user", "second", db);

    const recent = listRecentMessages(10, db);
    expect(recent[0].content).toBe("second");
  });
});

describe("memory", () => {
  it("creates, updates, lists, and deletes entries", () => {
    setMemory("favorite_color", "blue", db);
    expect(getMemory("favorite_color", db)?.value).toBe("blue");

    setMemory("favorite_color", "green", db);
    expect(getMemory("favorite_color", db)?.value).toBe("green");

    expect(listMemory(db)).toHaveLength(1);

    expect(deleteMemory("favorite_color", db)).toBe(true);
    expect(getMemory("favorite_color", db)).toBeUndefined();
    expect(deleteMemory("favorite_color", db)).toBe(false);
  });
});

describe("cost_ledger", () => {
  it("records entries and totals them for today/this month", () => {
    recordCost(
      { provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 100, outputUnits: 50, estimatedCostUsd: 0.001 },
      db,
    );
    recordCost(
      { provider: "anthropic", model: "claude-sonnet-4-5", inputUnits: 200, outputUnits: 100, estimatedCostUsd: 0.002 },
      db,
    );

    expect(getTodayCost(db)).toBeCloseTo(0.003, 6);
    expect(getCurrentMonthCost(db)).toBeCloseTo(0.003, 6);
    expect(listRecentCosts(10, db)).toHaveLength(2);
  });

  it("defaults unit_kind to tokens", () => {
    recordCost(
      { provider: "anthropic", model: "claude-haiku-4-5", inputUnits: 10, outputUnits: 5, estimatedCostUsd: 0 },
      db,
    );
    const [entry] = listRecentCosts(1, db);
    expect(entry.unitKind).toBe("tokens");
  });
});

describe("settings", () => {
  it("stores and retrieves raw string values", () => {
    setSetting("voice_adapter", "text", db);
    expect(getSetting("voice_adapter", db)).toBe("text");
  });

  it("stores and retrieves JSON values", () => {
    setSettingJson("allowed_dirs", ["~/Documents/JARVIS", "~/Desktop"], db);
    expect(getSettingJson<string[]>("allowed_dirs", db)).toEqual(["~/Documents/JARVIS", "~/Desktop"]);
  });

  it("returns undefined for unset keys", () => {
    expect(getSetting("does_not_exist", db)).toBeUndefined();
    expect(getSettingJson("does_not_exist", db)).toBeUndefined();
  });

  it("lists all settings as a map", () => {
    setSetting("a", "1", db);
    setSetting("b", "2", db);
    expect(getAllSettings(db)).toEqual({ a: "1", b: "2" });
  });
});

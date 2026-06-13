import { describe, it, expect } from "vitest";
import {
  PermissionTier,
  classifyTool,
  requiresConfirmation,
  tierLabel,
  PHASE0_DUMMY_ACTION,
  PHASE0_TIER_ASSIGNMENTS,
  DEFAULT_UNKNOWN_TIER,
} from "../core/permissions";

describe("permission tiers", () => {
  it("classifies the Phase 0 dummy action as Tier 0 (read-only)", () => {
    const tier = classifyTool(PHASE0_DUMMY_ACTION, PHASE0_TIER_ASSIGNMENTS);
    expect(tier).toBe(PermissionTier.ReadOnly);
  });

  it("defaults unknown tools to the most restrictive tier (R-5)", () => {
    const tier = classifyTool({ skill: "unknown", tool: "doAnything" }, PHASE0_TIER_ASSIGNMENTS);
    expect(tier).toBe(DEFAULT_UNKNOWN_TIER);
    expect(tier).toBe(PermissionTier.FinancialOrIrreversible);
  });

  it("never requires confirmation for Tier 0", () => {
    expect(requiresConfirmation(PermissionTier.ReadOnly)).toBe(false);
  });

  it("does not require confirmation for Tier 1 by default", () => {
    expect(requiresConfirmation(PermissionTier.ReversibleInternal)).toBe(false);
  });

  it("always requires confirmation for Tier 2", () => {
    expect(requiresConfirmation(PermissionTier.ExternalOrHardToReverse)).toBe(true);
  });

  it("always requires confirmation for Tier 3, and cannot be bypassed (R-1)", () => {
    expect(requiresConfirmation(PermissionTier.FinancialOrIrreversible)).toBe(true);
    expect(requiresConfirmation(PermissionTier.FinancialOrIrreversible, true)).toBe(true);
  });

  it("provides human-readable labels for every tier", () => {
    expect(tierLabel(PermissionTier.ReadOnly)).toMatch(/read-only/i);
    expect(tierLabel(PermissionTier.ReversibleInternal)).toMatch(/reversible/i);
    expect(tierLabel(PermissionTier.ExternalOrHardToReverse)).toMatch(/external/i);
    expect(tierLabel(PermissionTier.FinancialOrIrreversible)).toMatch(/financial/i);
  });
});

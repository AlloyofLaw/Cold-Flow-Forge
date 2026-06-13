// ---------------------------------------------------------------------------
// Skill registry (PRD Section 6.7 / FR-7.1-7.5).
//
// A "skill" is an MCP server that exposes one or more tools to the Brain.
// Phase 0 ships an EMPTY registry - no real skills are connected yet - but
// the data shapes here are what the Integrations panel (FR-7.2) and the
// permission framework (core/permissions.ts) will consume in later phases.
// ---------------------------------------------------------------------------

import type { PermissionTier } from "../core/permissions";

export type SkillConnectionStatus = "connected" | "disconnected" | "error";

/** Declares a single tool offered by a skill, and its assigned tier. */
export interface SkillToolDescriptor {
  name: string;
  description: string;
  tier: PermissionTier;
}

/** Describes one connected (or connectable) skill / MCP server. */
export interface SkillDescriptor {
  /** Stable identifier, used as the `skill` field in the activity log. */
  id: string;
  /** Human-readable name shown in the Integrations panel. */
  name: string;
  /** Reference to the MCP server (command, package, or URL) - TBD per skill. */
  mcpServerRef: string;
  status: SkillConnectionStatus;
  tools: SkillToolDescriptor[];
}

/**
 * The skill registry. Phase 0 intentionally has no entries: no real MCP
 * servers are connected yet (PRD Phase 0 scope). Later phases will populate
 * this from config + the credential vault as skills are connected.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, SkillDescriptor>();

  /** Register (or replace) a skill descriptor. */
  register(skill: SkillDescriptor): void {
    this.skills.set(skill.id, skill);
  }

  /** Remove a skill from the registry (e.g. on disconnect/revoke). */
  unregister(id: string): boolean {
    return this.skills.delete(id);
  }

  /** Get a single skill descriptor by id. */
  get(id: string): SkillDescriptor | undefined {
    return this.skills.get(id);
  }

  /** List all registered skills. */
  list(): SkillDescriptor[] {
    return Array.from(this.skills.values());
  }
}

/** Process-wide singleton registry (empty in Phase 0). */
export const skillRegistry = new SkillRegistry();

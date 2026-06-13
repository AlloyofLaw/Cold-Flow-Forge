// ---------------------------------------------------------------------------
// Skill registry (PRD Section 6.7 / FR-7.1-7.5).
//
// A "skill" is an MCP server that exposes one or more tools to the Brain.
// Phase 0 shipped an EMPTY registry - no real skills were connected yet.
// Phase 1 connects the first real skill (Google Calendar, read-only) and
// uses this registry to drive the generic tool-use loop (core/agent.ts):
// for every registered + connected skill, its `client` is asked for the
// tools it exposes, those are surfaced to the Brain, and tool calls are
// dispatched back through the same `client`.
//
// The registry stays general on purpose (FR-7.4): adding skill #2 (Gmail,
// Phase 2+) is "register another SkillDescriptor with a connected client",
// nothing in core/agent.ts needs to change.
// ---------------------------------------------------------------------------

import type { PermissionTier } from "../core/permissions";
import type { McpSkillClient } from "./mcpClient";

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
  /**
   * The connected MCP client for this skill, if `status === "connected"`.
   * The tool-use loop (core/agent.ts) uses this to list/call tools. Skills
   * that are merely catalogued but not connected (future
   * FR-7.2 Integrations panel entries) may omit this.
   */
  client?: McpSkillClient;
}

/**
 * The skill registry. Phase 0 shipped with no entries (no real MCP servers
 * connected yet). From Phase 1 onward, skills register themselves here
 * (e.g. skills/google-calendar/index.ts) during app/agent startup.
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

  /** List only skills that are connected and have an MCP client attached. */
  listConnected(): Array<SkillDescriptor & { client: McpSkillClient }> {
    const connected: Array<SkillDescriptor & { client: McpSkillClient }> = [];
    for (const skill of this.list()) {
      if (skill.status === "connected" && skill.client !== undefined) {
        connected.push({ ...skill, client: skill.client });
      }
    }
    return connected;
  }
}

/** Process-wide singleton registry (empty until skills register themselves). */
export const skillRegistry = new SkillRegistry();

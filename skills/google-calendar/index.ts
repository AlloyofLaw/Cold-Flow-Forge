// ---------------------------------------------------------------------------
// Google Calendar skill wiring (PRD Section 6.3, FR-7.1/FR-7.4).
//
// Connects the in-repo Google Calendar MCP server (server.ts) to an
// `McpSkillClient` (skills/mcpClient.ts) over an `InMemoryTransport`, and
// registers the resulting SkillDescriptor in the shared skill registry
// (skills/registry.ts) so the generic tool-use loop (core/agent.ts) can see
// its tools.
//
// Why InMemoryTransport (in-process) instead of stdio/subprocess: this
// server is code we wrote and trust (SEC-9 - "prefer an in-repo server you
// can trust and test"), so there's no isolation benefit to spawning it as a
// separate process, and running it in-process keeps Phase 1 simple to test
// headlessly (no child process to manage/clean up in CI). A future skill
// that wraps a third-party server would instead use the stdio transport via
// `@modelcontextprotocol/sdk/client/stdio.js`, which `McpSkillClient.connect`
// already supports (it accepts any `Transport`).
// ---------------------------------------------------------------------------

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { classifyTool, TIER_ASSIGNMENTS } from "../../core/permissions";
import { McpSkillClient } from "../mcpClient";
import { skillRegistry, type SkillDescriptor } from "../registry";
import { createGoogleCalendarServer, GOOGLE_CALENDAR_SKILL_ID } from "./server";

export { GOOGLE_CALENDAR_SKILL_ID } from "./server";
export * from "./auth";

/**
 * Connect the Google Calendar MCP server in-process and register it in the
 * skill registry. Safe to call with no Google credentials configured - the
 * server itself handles stub mode per-tool (server.ts), so the *connection*
 * always succeeds; only the *data* returned is a stub until the user
 * authorizes Google (README "Connect your Google Calendar").
 *
 * Idempotent-ish: calling this again replaces the previous registration with
 * a freshly-connected client.
 */
export async function registerGoogleCalendarSkill(): Promise<SkillDescriptor> {
  const server = createGoogleCalendarServer();
  const client = new McpSkillClient(GOOGLE_CALENDAR_SKILL_ID);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  // Order matters: the server must be listening before the client connects.
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();

  const descriptor: SkillDescriptor = {
    id: GOOGLE_CALENDAR_SKILL_ID,
    name: "Google Calendar (read + write events)",
    mcpServerRef: "in-process:skills/google-calendar/server.ts",
    status: "connected",
    client,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      // R-6: tier comes from core/permissions.ts's TIER_ASSIGNMENTS (the
      // Brain's enforcement table), never self-declared by the skill. A
      // future tool added here without a matching entry in TIER_ASSIGNMENTS
      // defaults to the most restrictive tier (R-5).
      tier: classifyTool({ skill: GOOGLE_CALENDAR_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS),
    })),
  };

  skillRegistry.register(descriptor);
  return descriptor;
}

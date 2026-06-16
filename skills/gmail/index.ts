// ---------------------------------------------------------------------------
// Gmail skill wiring (PRD Section 6.4, FR-7.1/FR-7.4).
//
// Connects the in-repo Gmail MCP server (server.ts) to an `McpSkillClient`
// (skills/mcpClient.ts) over an `InMemoryTransport`, and registers the
// resulting SkillDescriptor in the shared skill registry (skills/registry.ts)
// so the generic tool-use loop (core/agent.ts) can see its tools - mirroring
// skills/google-calendar/index.ts exactly.
// ---------------------------------------------------------------------------

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { classifyTool, TIER_ASSIGNMENTS } from "../../core/permissions";
import { McpSkillClient } from "../mcpClient";
import { skillRegistry, type SkillDescriptor } from "../registry";
import { createGmailServer, GMAIL_SKILL_ID } from "./server";

export { GMAIL_SKILL_ID } from "./server";
export * from "./auth";

/**
 * Connect the Gmail MCP server in-process and register it in the skill
 * registry. Safe to call with no Google credentials configured - the server
 * itself handles stub mode per-tool (server.ts), so the *connection* always
 * succeeds; only the *data* returned is a stub until the user authorizes
 * Gmail (README "Connect Gmail").
 *
 * Idempotent-ish: calling this again replaces the previous registration with
 * a freshly-connected client.
 */
export async function registerGmailSkill(): Promise<SkillDescriptor> {
  const server = createGmailServer();
  const client = new McpSkillClient(GMAIL_SKILL_ID);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();

  const descriptor: SkillDescriptor = {
    id: GMAIL_SKILL_ID,
    name: "Gmail (read + draft)",
    mcpServerRef: "in-process:skills/gmail/server.ts",
    status: "connected",
    client,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      // R-6: tier comes from core/permissions.ts's TIER_ASSIGNMENTS, never
      // self-declared by the skill.
      tier: classifyTool({ skill: GMAIL_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS),
    })),
  };

  skillRegistry.register(descriptor);
  return descriptor;
}

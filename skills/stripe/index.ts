// ---------------------------------------------------------------------------
// Stripe skill wiring (PRD Section 6.5, FR-7.1/FR-7.4).
//
// Connects the in-repo Stripe MCP server (server.ts) to an `McpSkillClient`
// (skills/mcpClient.ts) over an `InMemoryTransport`, and registers the
// resulting SkillDescriptor in the shared skill registry (skills/registry.ts)
// so the generic tool-use loop (core/agent.ts) can see its tools - mirroring
// skills/gmail/index.ts and skills/google-calendar/index.ts.
// ---------------------------------------------------------------------------

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { classifyTool, TIER_ASSIGNMENTS } from "../../core/permissions";
import { McpSkillClient } from "../mcpClient";
import { skillRegistry, type SkillDescriptor } from "../registry";
import { createStripeServer, STRIPE_SKILL_ID } from "./server";

export { STRIPE_SKILL_ID } from "./server";
export * from "./client";

/**
 * Connect the Stripe MCP server in-process and register it in the skill
 * registry. Safe to call with no Stripe API key configured - the server
 * itself handles stub mode per-tool (server.ts), so the *connection* always
 * succeeds; only the *data* returned is a stub until the user configures a
 * restricted TEST-MODE API key (README "Connect Stripe").
 *
 * Idempotent-ish: calling this again replaces the previous registration with
 * a freshly-connected client.
 */
export async function registerStripeSkill(): Promise<SkillDescriptor> {
  const server = createStripeServer();
  const client = new McpSkillClient(STRIPE_SKILL_ID);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();

  const descriptor: SkillDescriptor = {
    id: STRIPE_SKILL_ID,
    name: "Stripe (read-only, test mode)",
    mcpServerRef: "in-process:skills/stripe/server.ts",
    status: "connected",
    client,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      // R-6: tier comes from core/permissions.ts's TIER_ASSIGNMENTS, never
      // self-declared by the skill. All Stripe tools are Tier 0 (FR-5.2).
      tier: classifyTool({ skill: STRIPE_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS),
    })),
  };

  skillRegistry.register(descriptor);
  return descriptor;
}

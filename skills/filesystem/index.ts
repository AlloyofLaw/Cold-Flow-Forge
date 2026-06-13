// ---------------------------------------------------------------------------
// Local Filesystem skill wiring (PRD Section 6.6, FR-6.1..6.7, FR-7.1/FR-7.4).
//
// Connects the in-repo Local Filesystem MCP server (server.ts) to an
// `McpSkillClient` (skills/mcpClient.ts) over an `InMemoryTransport`, and
// registers the resulting SkillDescriptor in the shared skill registry
// (skills/registry.ts) - mirroring skills/stripe/index.ts and
// skills/gmail/index.ts.
//
// Unlike the OAuth/API-key skills, this skill has no "stub mode": it always
// operates on the real local filesystem, but ONLY within
// `config.allowedDirectory` (FR-6.4). Before connecting, this ensures that
// directory exists (creating it recursively if not), so the app starts
// cleanly on a fresh machine (`.jarvis-trash/` is created lazily on first
// delete, not here).
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { config } from "../../config";
import { classifyTool, TIER_ASSIGNMENTS } from "../../core/permissions";
import { McpSkillClient } from "../mcpClient";
import { skillRegistry, type SkillDescriptor } from "../registry";
import { createFilesystemServer, FILESYSTEM_SKILL_ID } from "./server";

export { FILESYSTEM_SKILL_ID, TRASH_DIR_NAME, MAX_READ_FILE_BYTES } from "./server";
export * from "./paths";

/**
 * Connect the Local Filesystem MCP server in-process and register it in the
 * skill registry. Ensures `config.allowedDirectory` exists first (FR-6.4) so
 * tools never fail with ENOENT on a fresh machine.
 *
 * Idempotent-ish: calling this again replaces the previous registration with
 * a freshly-connected client.
 */
export async function registerFilesystemSkill(): Promise<SkillDescriptor> {
  await fs.mkdir(config.allowedDirectory, { recursive: true });

  const server = createFilesystemServer();
  const client = new McpSkillClient(FILESYSTEM_SKILL_ID);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();

  const descriptor: SkillDescriptor = {
    id: FILESYSTEM_SKILL_ID,
    name: "Local Filesystem (JARVIS folder)",
    mcpServerRef: "in-process:skills/filesystem/server.ts",
    status: "connected",
    client,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      // R-6: tier comes from core/permissions.ts's TIER_ASSIGNMENTS (and, for
      // write_file/move, CLASSIFIER_HOOKS) - never self-declared by the skill.
      tier: classifyTool({ skill: FILESYSTEM_SKILL_ID, tool: tool.name }, TIER_ASSIGNMENTS),
    })),
  };

  skillRegistry.register(descriptor);
  return descriptor;
}

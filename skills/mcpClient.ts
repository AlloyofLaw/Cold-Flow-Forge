// ---------------------------------------------------------------------------
// MCP client plumbing (PRD Section 15: "MCP client plumbing + a skill
// registry (no real skills connected yet)").
//
// This module wraps the official `@modelcontextprotocol/sdk` Client so the
// agent core can later connect to real MCP servers (filesystem, Google
// Calendar, Gmail, Stripe, ...) using a consistent interface. Phase 0 does
// not connect to any servers - this exists so the seam is in place and the
// dependency wiring is exercised.
// ---------------------------------------------------------------------------

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// `Transport` itself is not part of the package's public `exports` map, so
// derive its type from `Client#connect`'s parameter instead of deep-
// importing "@modelcontextprotocol/sdk/shared/transport.js".
type Transport = Parameters<Client["connect"]>[0];

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/**
 * A thin wrapper around an MCP `Client` connected over a given transport.
 * Each connected skill (Phase 1+) will own one of these.
 */
export class McpSkillClient {
  private readonly client: Client;
  private connected = false;

  constructor(
    private readonly name: string,
    private readonly version: string = "0.1.0",
  ) {
    this.client = new Client({ name: `jarvis-${name}`, version: this.version });
  }

  /** Connect to the MCP server over the given transport. */
  async connect(transport: Transport): Promise<void> {
    await this.client.connect(transport);
    this.connected = true;
  }

  /** Whether `connect()` has succeeded. */
  isConnected(): boolean {
    return this.connected;
  }

  /** List the tools this MCP server exposes. */
  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /** Call a tool on the connected MCP server. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name, arguments: args });
  }

  /** Close the underlying connection. */
  async close(): Promise<void> {
    await this.client.close();
    this.connected = false;
  }
}

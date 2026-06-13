// ---------------------------------------------------------------------------
// Local Filesystem MCP server (PRD Section 6.6, FR-6.1..6.7, Phase 4 Part C).
//
// A self-contained MCP server we control (per SEC-9), giving JARVIS access to
// a SINGLE directory on disk: `config.allowedDirectory` (default
// `~/Claude 2nd brain/JARVIS/`, FR-6.4, overridable via JARVIS_ALLOWED_DIR).
// EVERY tool resolves its path argument(s) through
// `skills/filesystem/paths.ts`'s `resolveWithinRoot` before touching the
// filesystem - this is the FR-6.4 safety boundary, and refuses (with a clear
// error, isError: true) any path that would escape the allowed root via `..`
// traversal, an absolute path outside the root, etc.
//
// Tools exposed:
//   READ (Tier 0, FR-6.1/6.2):
//   - list_directory: list entries (name, isDirectory, size, mtime) in a
//     directory within the allowed root.
//   - read_file: read a text file's contents. Refuses/truncates files over
//     ~1MB with a clear message (binary/huge files are not useful to the
//     Brain and would blow the context window).
//   - get_file_info: size, mtime, isDirectory, etc. for a single path.
//
//   STATE-DEPENDENT WRITES (Tier 1 if new, Tier 2 if overwrite - FR-6.3/6.5,
//   core/permissions.ts CLASSIFIER_HOOKS.filesystem):
//   - write_file: create or overwrite a text file.
//   - move: move/rename a file or directory within the allowed root.
//
//   ALWAYS Tier 1 (FR-6.3, reversible & internal):
//   - create_directory: create a directory (recursively); no-ops if it
//     already exists as a directory.
//
//   DELETE -> TRASH (Tier 2, FR-6.5 - confirmation required, but
//   RECOVERABLE, so NOT Tier 3):
//   - delete_file / delete_directory: instead of permanently deleting,
//     MOVES the target into `.jarvis-trash/` inside the allowed root, with a
//     timestamp-prefixed name to avoid collisions (FR-6.5's "backup/undo
//     snapshot"). `.jarvis-trash/` is created lazily on first delete.
//
// Startup: skills/filesystem/index.ts ensures the allowed root exists
// (creating it recursively if not) so the app starts cleanly on a fresh
// machine. `.jarvis-trash/` is NOT created at startup.
//
// This server is run IN-PROCESS (see index.ts), connected to its client via
// `InMemoryTransport`, exactly like the other built-in skills. There is no
// "stub mode" here in the network sense - the filesystem is always "real",
// but every operation is sandboxed to the allowed root.
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../../config";
import { resolveWithinRoot } from "./paths";

export const FILESYSTEM_SKILL_ID = "filesystem";

/** Name of the trash directory created lazily inside the allowed root (FR-6.5). */
export const TRASH_DIR_NAME = ".jarvis-trash";

/** Files larger than this are refused/truncated by `read_file` (FR-6.2). */
export const MAX_READ_FILE_BYTES = 1024 * 1024; // ~1MB

const pathSchema = z
  .string()
  .min(1)
  .describe(
    "Path to the file or directory, relative to the allowed JARVIS folder (or an absolute path " +
      "inside it). Paths outside the allowed folder are refused.",
  );

/** Resolve `requestedPath` against the configured allowed root, or return an error result if it escapes. */
function resolveOrError(requestedPath: string): { resolved: string } | { error: string } {
  const resolved = resolveWithinRoot(config.allowedDirectory, requestedPath);
  if (!resolved) {
    return {
      error:
        `Path "${requestedPath}" is outside the allowed JARVIS folder ` +
        `(${config.allowedDirectory}) and was refused (FR-6.4).`,
    };
  }
  return { resolved };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

interface EntryInfo {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modifiedAt: string; // ISO 8601
}

async function statEntry(fullPath: string, name: string): Promise<EntryInfo> {
  const stat = await fs.stat(fullPath);
  return {
    name,
    isDirectory: stat.isDirectory(),
    isFile: stat.isFile(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

/** Timestamp prefix for trashed entries, e.g. "20260613T083000". */
function trashTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").slice(0, 15);
}

/**
 * Build the Local Filesystem MCP server.
 *
 * `config.allowedDirectory` is read fresh on every call (not cached at
 * server-build time) so tests that override it via config mocks behave
 * predictably, and so a future Integrations panel could change it without
 * restarting.
 */
export function createFilesystemServer(): McpServer {
  const server = new McpServer({ name: "jarvis-filesystem", version: "0.1.0" });

  server.registerTool(
    "list_directory",
    {
      title: "List a directory",
      description:
        "List the entries (files and subdirectories) of a directory within the allowed JARVIS " +
        "folder (read-only, Tier 0, FR-6.1). Each entry includes its name, whether it's a " +
        "directory or file, size in bytes, and last-modified time.",
      inputSchema: {
        path: pathSchema.optional().describe("Directory to list. Omit (or '.') for the allowed folder's root."),
      },
    },
    async ({ path: requestedPath }) => {
      const result = resolveOrError(requestedPath ?? ".");
      if ("error" in result) return errorResult(result.error);

      try {
        const names = await fs.readdir(result.resolved);
        const entries = await Promise.all(
          names.map((name) => statEntry(path.join(result.resolved, name), name)),
        );
        return jsonResult({ path: requestedPath ?? ".", entries });
      } catch (error) {
        return errorResult(`Failed to list directory "${requestedPath ?? "."}": ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "read_file",
    {
      title: "Read a text file",
      description:
        "Read the contents of a text file within the allowed JARVIS folder (read-only, Tier 0, " +
        `FR-6.1/6.2). Files larger than ${MAX_READ_FILE_BYTES} bytes (~1MB) are refused with a ` +
        "clear message rather than returned, to avoid flooding the conversation with huge or " +
        "binary content.",
      inputSchema: {
        path: pathSchema,
      },
    },
    async ({ path: requestedPath }) => {
      const result = resolveOrError(requestedPath);
      if ("error" in result) return errorResult(result.error);

      try {
        const stat = await fs.stat(result.resolved);
        if (stat.isDirectory()) {
          return errorResult(`"${requestedPath}" is a directory, not a file. Use list_directory instead.`);
        }
        if (stat.size > MAX_READ_FILE_BYTES) {
          return errorResult(
            `"${requestedPath}" is ${stat.size} bytes, which exceeds the ${MAX_READ_FILE_BYTES}-byte ` +
              "(~1MB) limit for read_file. Refusing to read it - consider asking for a smaller file " +
              "or a specific excerpt.",
          );
        }

        const content = await fs.readFile(result.resolved, "utf-8");
        return jsonResult({ path: requestedPath, size: stat.size, content });
      } catch (error) {
        return errorResult(`Failed to read "${requestedPath}": ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_file_info",
    {
      title: "Get file/directory info",
      description:
        "Get metadata (size, last-modified time, whether it's a directory or file) for a path " +
        "within the allowed JARVIS folder (read-only, Tier 0, FR-6.1).",
      inputSchema: {
        path: pathSchema,
      },
    },
    async ({ path: requestedPath }) => {
      const result = resolveOrError(requestedPath);
      if ("error" in result) return errorResult(result.error);

      try {
        const info = await statEntry(result.resolved, path.basename(result.resolved));
        return jsonResult({ path: requestedPath, ...info });
      } catch (error) {
        return errorResult(`Failed to get info for "${requestedPath}": ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "write_file",
    {
      title: "Write a text file",
      description:
        "Create or overwrite a text file within the allowed JARVIS folder (FR-6.3/6.5). Creating a " +
        "NEW file is Tier 1 (no confirmation); OVERWRITING an existing file is Tier 2 (confirmation " +
        "required, since the previous contents are replaced).",
      inputSchema: {
        path: pathSchema,
        content: z.string().describe("Text content to write to the file."),
      },
    },
    async ({ path: requestedPath, content }) => {
      const result = resolveOrError(requestedPath);
      if ("error" in result) return errorResult(result.error);

      try {
        let previousSize: number | undefined;
        let existed = false;
        try {
          const stat = await fs.stat(result.resolved);
          if (stat.isDirectory()) {
            return errorResult(`"${requestedPath}" is a directory - cannot write a file there.`);
          }
          existed = true;
          previousSize = stat.size;
        } catch {
          existed = false;
        }

        await fs.mkdir(path.dirname(result.resolved), { recursive: true });
        await fs.writeFile(result.resolved, content, "utf-8");
        const newSize = Buffer.byteLength(content, "utf-8");

        return jsonResult({
          path: requestedPath,
          created: !existed,
          overwritten: existed,
          summary: existed ? `overwrote (${previousSize} bytes -> ${newSize} bytes)` : `created (${newSize} bytes)`,
          previousSize: previousSize ?? null,
          newSize,
        });
      } catch (error) {
        return errorResult(`Failed to write "${requestedPath}": ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "create_directory",
    {
      title: "Create a directory",
      description:
        "Create a directory (recursively) within the allowed JARVIS folder (Tier 1, FR-6.3, " +
        "reversible & internal). No-ops (success) if the directory already exists.",
      inputSchema: {
        path: pathSchema,
      },
    },
    async ({ path: requestedPath }) => {
      const result = resolveOrError(requestedPath);
      if ("error" in result) return errorResult(result.error);

      try {
        let existed = false;
        try {
          const stat = await fs.stat(result.resolved);
          if (!stat.isDirectory()) {
            return errorResult(`"${requestedPath}" already exists and is not a directory.`);
          }
          existed = true;
        } catch {
          existed = false;
        }

        await fs.mkdir(result.resolved, { recursive: true });
        return jsonResult({
          path: requestedPath,
          created: !existed,
          summary: existed ? "already existed" : "created",
        });
      } catch (error) {
        return errorResult(`Failed to create directory "${requestedPath}": ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "move",
    {
      title: "Move or rename a file/directory",
      description:
        "Move or rename a file or directory within the allowed JARVIS folder (FR-6.3/6.5). Pass " +
        "`path` (source) and `destination`. Moving to a NEW destination is Tier 1 (no " +
        "confirmation); moving to a destination that ALREADY EXISTS (overwriting it) is Tier 2 " +
        "(confirmation required).",
      inputSchema: {
        path: pathSchema.describe("Source path, relative to the allowed JARVIS folder."),
        destination: pathSchema.describe("Destination path, relative to the allowed JARVIS folder."),
      },
    },
    async ({ path: requestedPath, destination }) => {
      const source = resolveOrError(requestedPath);
      if ("error" in source) return errorResult(source.error);
      const dest = resolveOrError(destination);
      if ("error" in dest) return errorResult(dest.error);

      try {
        let existedAtDestination = false;
        try {
          await fs.stat(dest.resolved);
          existedAtDestination = true;
        } catch {
          existedAtDestination = false;
        }

        await fs.mkdir(path.dirname(dest.resolved), { recursive: true });
        await fs.rename(source.resolved, dest.resolved);

        return jsonResult({
          path: requestedPath,
          destination,
          overwritten: existedAtDestination,
          summary: existedAtDestination
            ? `moved "${requestedPath}" to "${destination}" (overwriting existing destination)`
            : `moved "${requestedPath}" to "${destination}"`,
        });
      } catch (error) {
        return errorResult(`Failed to move "${requestedPath}" to "${destination}": ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "delete_file",
    {
      title: "Delete a file (to trash)",
      description:
        "Delete a file within the allowed JARVIS folder (Tier 2, FR-6.5 - confirmation required). " +
        `Instead of permanently deleting, the file is MOVED into "${TRASH_DIR_NAME}/" inside the ` +
        "allowed folder, with a timestamp prefix to avoid name collisions - this is recoverable, " +
        "not a permanent delete.",
      inputSchema: {
        path: pathSchema,
      },
    },
    async ({ path: requestedPath }) => {
      const result = resolveOrError(requestedPath);
      if ("error" in result) return errorResult(result.error);

      try {
        const stat = await fs.stat(result.resolved);
        if (stat.isDirectory()) {
          return errorResult(`"${requestedPath}" is a directory. Use delete_directory instead.`);
        }

        const trashed = await moveToTrash(result.resolved);
        return jsonResult({
          path: requestedPath,
          movedTo: trashed,
          summary: `moved to ${TRASH_DIR_NAME}/ (recoverable, not permanently deleted)`,
        });
      } catch (error) {
        return errorResult(`Failed to delete "${requestedPath}": ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "delete_directory",
    {
      title: "Delete a directory (to trash)",
      description:
        "Delete a directory (and everything inside it) within the allowed JARVIS folder (Tier 2, " +
        `FR-6.5 - confirmation required). Instead of permanently deleting, the directory is MOVED ` +
        `into "${TRASH_DIR_NAME}/" inside the allowed folder, with a timestamp prefix to avoid name ` +
        "collisions - this is recoverable, not a permanent delete.",
      inputSchema: {
        path: pathSchema,
      },
    },
    async ({ path: requestedPath }) => {
      const result = resolveOrError(requestedPath);
      if ("error" in result) return errorResult(result.error);

      try {
        const stat = await fs.stat(result.resolved);
        if (!stat.isDirectory()) {
          return errorResult(`"${requestedPath}" is a file. Use delete_file instead.`);
        }

        const trashed = await moveToTrash(result.resolved);
        return jsonResult({
          path: requestedPath,
          movedTo: trashed,
          summary: `moved to ${TRASH_DIR_NAME}/ (recoverable, not permanently deleted)`,
        });
      } catch (error) {
        return errorResult(`Failed to delete directory "${requestedPath}": ${(error as Error).message}`);
      }
    },
  );

  return server;
}

/**
 * Move `sourcePath` (an absolute, already-validated-in-bounds path) into
 * `.jarvis-trash/` inside the configured allowed root, with a
 * timestamp-prefixed name to avoid collisions (FR-6.5). Creates
 * `.jarvis-trash/` lazily if it doesn't exist yet. Returns the path the
 * entry was moved to, relative to the allowed root.
 */
async function moveToTrash(sourcePath: string): Promise<string> {
  const trashDir = path.join(config.allowedDirectory, TRASH_DIR_NAME);
  await fs.mkdir(trashDir, { recursive: true });

  const baseName = path.basename(sourcePath);
  let trashName = `${trashTimestamp()}-${baseName}`;
  let trashPath = path.join(trashDir, trashName);

  // Extremely unlikely collision (same second, same name) - disambiguate.
  let suffix = 1;
  while (
    await fs
      .stat(trashPath)
      .then(() => true)
      .catch(() => false)
  ) {
    trashName = `${trashTimestamp()}-${suffix}-${baseName}`;
    trashPath = path.join(trashDir, trashName);
    suffix += 1;
  }

  await fs.rename(sourcePath, trashPath);
  return path.relative(config.allowedDirectory, trashPath);
}

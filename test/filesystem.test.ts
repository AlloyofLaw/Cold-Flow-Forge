import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Local Filesystem skill tests (PRD Section 6.6, FR-6.1..6.7, Phase 4 Part C).
//
// ALL tests use a fresh `os.tmpdir()` subdirectory as the configured allowed
// root (`config.allowedDirectory`) - NEVER the real
// `~/Claude 2nd brain/JARVIS/` path or anything under the repo. The mocked
// config reads from a mutable module-level variable (`currentAllowedDir`) so
// each test can point at its own temp directory without re-mocking modules.
// ---------------------------------------------------------------------------

let currentAllowedDir = "";

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    config: {
      ...actual.config,
      get allowedDirectory() {
        return currentAllowedDir;
      },
    },
  };
});

function makeTempAllowedDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-fs-test-"));
}

function cleanupDir(dir: string): void {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

describe("resolveWithinRoot (FR-6.4 path-safety boundary)", () => {
  const root = "/allowed-root";

  it("resolves a simple nested relative path inside the root", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    expect(resolveWithinRoot(root, "foo/bar.txt")).toBe(path.join(root, "foo/bar.txt"));
  });

  it("returns the root itself when given '.' or an empty-ish relative path", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    expect(resolveWithinRoot(root, ".")).toBe(path.resolve(root));
  });

  it("normalizes trailing slashes and redundant segments", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    expect(resolveWithinRoot(root, "foo/./bar/../baz/")).toBe(path.join(root, "foo/baz"));
  });

  it("rejects '..' traversal that escapes the root", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    expect(resolveWithinRoot(root, "..")).toBeUndefined();
    expect(resolveWithinRoot(root, "../etc/passwd")).toBeUndefined();
    expect(resolveWithinRoot(root, "foo/../../etc/passwd")).toBeUndefined();
  });

  it("rejects an absolute path outside the root", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    expect(resolveWithinRoot(root, "/etc/passwd")).toBeUndefined();
    expect(resolveWithinRoot(root, "/")).toBeUndefined();
  });

  it("accepts an absolute path that IS inside the root", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    expect(resolveWithinRoot(root, path.join(root, "sub/file.txt"))).toBe(path.join(root, "sub/file.txt"));
  });

  it("rejects a sibling directory that merely shares the root as a string prefix", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    // "/allowed-root-evil" starts with "/allowed-root" as a raw string, but is
    // NOT inside "/allowed-root" - must be rejected.
    expect(resolveWithinRoot(root, "/allowed-root-evil/file.txt")).toBeUndefined();
    expect(resolveWithinRoot(root, "/allowed-root-evil")).toBeUndefined();
  });

  it("rejects empty or non-string input", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    expect(resolveWithinRoot(root, "")).toBeUndefined();
  });

  it("returns the root for a path equal to the root with a trailing slash", async () => {
    const { resolveWithinRoot } = await import("../skills/filesystem/paths");
    expect(resolveWithinRoot(root, `${root}/`)).toBe(path.resolve(root));
  });
});

describe("Local Filesystem skill - allowed-root auto-creation", () => {
  let tempBase: string;

  beforeEach(() => {
    tempBase = makeTempAllowedDir();
  });

  afterEach(() => {
    cleanupDir(tempBase);
  });

  it("creates the allowed root recursively on registration if it doesn't exist", async () => {
    const nestedDir = path.join(tempBase, "does", "not", "exist", "yet");
    currentAllowedDir = nestedDir;

    expect(fs.existsSync(nestedDir)).toBe(false);

    const { registerFilesystemSkill, FILESYSTEM_SKILL_ID } = await import("../skills/filesystem");
    const { skillRegistry } = await import("../skills/registry");

    const descriptor = await registerFilesystemSkill();

    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.statSync(nestedDir).isDirectory()).toBe(true);
    expect(descriptor.status).toBe("connected");
    expect(descriptor.id).toBe(FILESYSTEM_SKILL_ID);
    expect(skillRegistry.get(FILESYSTEM_SKILL_ID)).toBeDefined();
  });
});

describe("Local Filesystem skill - tools and tier classification", () => {
  let allowedDir: string;

  beforeEach(() => {
    allowedDir = makeTempAllowedDir();
    currentAllowedDir = allowedDir;
  });

  afterEach(() => {
    cleanupDir(allowedDir);
  });

  async function getClient() {
    const { registerFilesystemSkill, FILESYSTEM_SKILL_ID } = await import("../skills/filesystem");
    const { skillRegistry } = await import("../skills/registry");
    await registerFilesystemSkill();
    return skillRegistry.get(FILESYSTEM_SKILL_ID)!.client!;
  }

  function readJson(raw: unknown): any {
    const content = (raw as { content: Array<{ type: string; text: string }> }).content;
    return JSON.parse(content[0].text);
  }

  it("registers Tier 0 read tools, Tier 1 create_directory, and Tier 2 delete tools", async () => {
    const { PermissionTier, classifyTool, TIER_ASSIGNMENTS } = await import("../core/permissions");
    const { FILESYSTEM_SKILL_ID } = await import("../skills/filesystem");
    const client = await getClient();

    const tools = (await client.listTools()).map((t) => t.name).sort();
    expect(tools).toEqual([
      "create_directory",
      "delete_directory",
      "delete_file",
      "get_file_info",
      "list_directory",
      "move",
      "read_file",
      "write_file",
    ]);

    for (const t of ["list_directory", "read_file", "get_file_info"]) {
      expect(classifyTool({ skill: FILESYSTEM_SKILL_ID, tool: t }, TIER_ASSIGNMENTS)).toBe(PermissionTier.ReadOnly);
    }
    expect(classifyTool({ skill: FILESYSTEM_SKILL_ID, tool: "create_directory" }, TIER_ASSIGNMENTS)).toBe(
      PermissionTier.ReversibleInternal,
    );
    for (const t of ["delete_file", "delete_directory"]) {
      expect(classifyTool({ skill: FILESYSTEM_SKILL_ID, tool: t }, TIER_ASSIGNMENTS)).toBe(
        PermissionTier.ExternalOrHardToReverse,
      );
    }
  });

  it("write_file to a NEW path classifies as Tier 1 (no confirmation)", async () => {
    const { PermissionTier, classifyTool, TIER_ASSIGNMENTS, CLASSIFIER_HOOKS } = await import("../core/permissions");

    const tier = classifyTool(
      { skill: "filesystem", tool: "write_file" },
      TIER_ASSIGNMENTS,
      { path: "new-file.txt", content: "hello" },
      CLASSIFIER_HOOKS,
    );
    expect(tier).toBe(PermissionTier.ReversibleInternal);
  });

  it("write_file OVERWRITING an existing path classifies as Tier 2 (confirmation required)", async () => {
    const { PermissionTier, classifyTool, TIER_ASSIGNMENTS, CLASSIFIER_HOOKS } = await import("../core/permissions");

    const existingFile = path.join(allowedDir, "existing.txt");
    fs.writeFileSync(existingFile, "old content");

    const tier = classifyTool(
      { skill: "filesystem", tool: "write_file" },
      TIER_ASSIGNMENTS,
      { path: "existing.txt", content: "new content" },
      CLASSIFIER_HOOKS,
    );
    expect(tier).toBe(PermissionTier.ExternalOrHardToReverse);
  });

  it("move to a NEW destination classifies as Tier 1, to an EXISTING destination as Tier 2", async () => {
    const { PermissionTier, classifyTool, TIER_ASSIGNMENTS, CLASSIFIER_HOOKS } = await import("../core/permissions");

    fs.writeFileSync(path.join(allowedDir, "dest-exists.txt"), "stuff");

    const newDestTier = classifyTool(
      { skill: "filesystem", tool: "move" },
      TIER_ASSIGNMENTS,
      { path: "a.txt", destination: "b.txt" },
      CLASSIFIER_HOOKS,
    );
    expect(newDestTier).toBe(PermissionTier.ReversibleInternal);

    const overwriteDestTier = classifyTool(
      { skill: "filesystem", tool: "move" },
      TIER_ASSIGNMENTS,
      { path: "a.txt", destination: "dest-exists.txt" },
      CLASSIFIER_HOOKS,
    );
    expect(overwriteDestTier).toBe(PermissionTier.ExternalOrHardToReverse);
  });

  it("list_directory, write_file, read_file, get_file_info round-trip within the allowed root", async () => {
    const client = await getClient();

    const writeRaw = await client.callTool("write_file", { path: "notes.txt", content: "hello world" });
    const writePayload = readJson(writeRaw);
    expect(writePayload.created).toBe(true);
    expect(writePayload.overwritten).toBe(false);
    expect(writePayload.summary).toMatch(/created/);

    const readRaw = await client.callTool("read_file", { path: "notes.txt" });
    const readPayload = readJson(readRaw);
    expect(readPayload.content).toBe("hello world");

    const infoRaw = await client.callTool("get_file_info", { path: "notes.txt" });
    const infoPayload = readJson(infoRaw);
    expect(infoPayload.isFile).toBe(true);
    expect(infoPayload.isDirectory).toBe(false);
    expect(infoPayload.size).toBe(Buffer.byteLength("hello world"));

    const listRaw = await client.callTool("list_directory", {});
    const listPayload = readJson(listRaw);
    const entryNames = listPayload.entries.map((e: { name: string }) => e.name);
    expect(entryNames).toContain("notes.txt");
  });

  it("write_file overwriting an existing file reports old size -> new size", async () => {
    const client = await getClient();

    await client.callTool("write_file", { path: "notes.txt", content: "12345" });
    const overwriteRaw = await client.callTool("write_file", { path: "notes.txt", content: "1234567890" });
    const payload = readJson(overwriteRaw);

    expect(payload.created).toBe(false);
    expect(payload.overwritten).toBe(true);
    expect(payload.previousSize).toBe(5);
    expect(payload.newSize).toBe(10);
  });

  it("read_file refuses files larger than the ~1MB cap with a clear message", async () => {
    const { MAX_READ_FILE_BYTES } = await import("../skills/filesystem");
    const client = await getClient();

    const bigContent = "x".repeat(MAX_READ_FILE_BYTES + 1);
    fs.writeFileSync(path.join(allowedDir, "big.txt"), bigContent);

    const raw = (await client.callTool("read_file", { path: "big.txt" })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(raw.isError).toBe(true);
    expect(raw.content[0].text).toMatch(/exceeds/i);
  });

  it("create_directory creates a new directory, and no-ops on an existing directory", async () => {
    const client = await getClient();

    const createRaw = await client.callTool("create_directory", { path: "sub/nested" });
    const createPayload = readJson(createRaw);
    expect(createPayload.created).toBe(true);
    expect(fs.statSync(path.join(allowedDir, "sub", "nested")).isDirectory()).toBe(true);

    const againRaw = await client.callTool("create_directory", { path: "sub/nested" });
    const againPayload = readJson(againRaw);
    expect(againPayload.created).toBe(false);
    expect(againPayload.summary).toMatch(/already existed/);
  });

  it("move renames a file within the allowed root", async () => {
    const client = await getClient();

    await client.callTool("write_file", { path: "source.txt", content: "move me" });
    const moveRaw = await client.callTool("move", { path: "source.txt", destination: "moved/destination.txt" });
    const movePayload = readJson(moveRaw);

    expect(movePayload.overwritten).toBe(false);
    expect(fs.existsSync(path.join(allowedDir, "source.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(allowedDir, "moved", "destination.txt"), "utf-8")).toBe("move me");
  });

  it("all tools refuse paths that escape the allowed root", async () => {
    const client = await getClient();

    for (const call of [
      () => client.callTool("read_file", { path: "../escape.txt" }),
      () => client.callTool("write_file", { path: "../escape.txt", content: "x" }),
      () => client.callTool("list_directory", { path: "/etc" }),
      () => client.callTool("delete_file", { path: "../../etc/passwd" }),
    ]) {
      const raw = (await call()) as { isError?: boolean; content: Array<{ text: string }> };
      expect(raw.isError).toBe(true);
      expect(raw.content[0].text).toMatch(/outside the allowed/i);
    }
  });

  it("delete_file moves a file to .jarvis-trash/ with a timestamp prefix, content intact, not truly deleted", async () => {
    const { TRASH_DIR_NAME } = await import("../skills/filesystem");
    const client = await getClient();

    await client.callTool("write_file", { path: "secret.txt", content: "delete me" });

    const deleteRaw = await client.callTool("delete_file", { path: "secret.txt" });
    const deletePayload = readJson(deleteRaw);

    expect(fs.existsSync(path.join(allowedDir, "secret.txt"))).toBe(false);

    const trashDir = path.join(allowedDir, TRASH_DIR_NAME);
    expect(fs.existsSync(trashDir)).toBe(true);

    const trashedFiles = fs.readdirSync(trashDir);
    expect(trashedFiles).toHaveLength(1);
    expect(trashedFiles[0]).toMatch(/^\d{8}T\d{6}Z?-secret\.txt$/);
    expect(fs.readFileSync(path.join(trashDir, trashedFiles[0]), "utf-8")).toBe("delete me");

    expect(deletePayload.movedTo).toContain(TRASH_DIR_NAME);
    expect(deletePayload.summary).toMatch(/recoverable/i);
  });

  it("delete_directory moves a directory (with contents) to .jarvis-trash/, content intact", async () => {
    const { TRASH_DIR_NAME } = await import("../skills/filesystem");
    const client = await getClient();

    await client.callTool("create_directory", { path: "project" });
    await client.callTool("write_file", { path: "project/file.txt", content: "project file" });

    const deleteRaw = await client.callTool("delete_directory", { path: "project" });
    const deletePayload = readJson(deleteRaw);

    expect(fs.existsSync(path.join(allowedDir, "project"))).toBe(false);

    const trashDir = path.join(allowedDir, TRASH_DIR_NAME);
    const trashedDirs = fs.readdirSync(trashDir);
    expect(trashedDirs).toHaveLength(1);
    expect(trashedDirs[0]).toMatch(/-project$/);
    expect(fs.readFileSync(path.join(trashDir, trashedDirs[0], "file.txt"), "utf-8")).toBe("project file");

    expect(deletePayload.summary).toMatch(/recoverable/i);
  });

  it("delete_file on a directory, and delete_directory on a file, are refused with a clear message", async () => {
    const client = await getClient();

    await client.callTool("create_directory", { path: "adir" });
    await client.callTool("write_file", { path: "afile.txt", content: "x" });

    const dirAsFile = (await client.callTool("delete_file", { path: "adir" })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(dirAsFile.isError).toBe(true);
    expect(dirAsFile.content[0].text).toMatch(/directory/i);

    const fileAsDir = (await client.callTool("delete_directory", { path: "afile.txt" })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(fileAsDir.isError).toBe(true);
    expect(fileAsDir.content[0].text).toMatch(/file/i);
  });
});

describe("Confirmation descriptions for filesystem tools (FR-6.3/6.5)", () => {
  it("describeToolCall for write_file (overwrite) and delete tools mention .jarvis-trash/ recoverability", async () => {
    const { describeToolCall } = await import("../core/permissions");

    const writeDescription = describeToolCall({ skill: "filesystem", tool: "write_file" }, { path: "notes.txt" });
    expect(writeDescription).toContain("notes.txt");
    expect(writeDescription).toMatch(/overwrite/i);

    const deleteFileDescription = describeToolCall({ skill: "filesystem", tool: "delete_file" }, { path: "notes.txt" });
    expect(deleteFileDescription).toMatch(/jarvis-trash/i);
    expect(deleteFileDescription).toMatch(/not.*permanently/i);

    const deleteDirDescription = describeToolCall({ skill: "filesystem", tool: "delete_directory" }, { path: "project" });
    expect(deleteDirDescription).toMatch(/jarvis-trash/i);

    const moveDescription = describeToolCall(
      { skill: "filesystem", tool: "move" },
      { path: "a.txt", destination: "b.txt" },
    );
    expect(moveDescription).toContain("a.txt");
    expect(moveDescription).toContain("b.txt");
  });
});

describe("config.allowedDirectory defaults (FR-6.4)", () => {
  it("defaults to ~/Claude 2nd brain/JARVIS/ derived via os.homedir(), and is overridable via JARVIS_ALLOWED_DIR", async () => {
    const { loadConfig, defaultAllowedDirectory } = await import("../config");

    const defaultDir = defaultAllowedDirectory();
    expect(defaultDir).toBe(path.join(os.homedir(), "Claude 2nd brain", "JARVIS"));

    const withDefault = loadConfig({});
    expect(withDefault.allowedDirectory).toBe(defaultDir);

    const overridden = loadConfig({ JARVIS_ALLOWED_DIR: "/tmp/custom-jarvis-dir" });
    expect(overridden.allowedDirectory).toBe(path.resolve("/tmp/custom-jarvis-dir"));
  });
});

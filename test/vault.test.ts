import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Force the local-file fallback backend so this test is deterministic in
// headless/CI environments without a Secret Service / Keychain daemon
// (PRD SEC-1, Phase 0 acceptance criterion #5).
//
// Use a dedicated vault directory for this file (via `vaultDir`) so it never
// shares an on-disk vault file/key with other test files that also use the
// file-vault backend (e.g. test/totp.test.ts) - vitest runs test files in
// parallel by default, and a shared file would race.
//
// `vi.mock` factories are hoisted above all other statements in the file, so
// the vault directory path is recomputed inline here (and again below for use
// in this file's own cleanup helpers) rather than shared via a top-level
// const.
vi.mock("../config", async () => {
  const path = await import("node:path");
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    config: {
      ...actual.config,
      vaultBackend: "file",
      vaultDevPassphrase: "test-passphrase-for-vault-spec",
      vaultDir: path.resolve(__dirname, "..", "data", ".vault-test-vault"),
    },
  };
});

const VAULT_DIR = path.resolve(__dirname, "..", "data", ".vault-test-vault");
const VAULT_FILE = path.join(VAULT_DIR, ".jarvis-dev-vault.json");
const VAULT_KEY_FILE = path.join(VAULT_DIR, ".jarvis-dev-vault.key");

function cleanupVaultFiles(): void {
  for (const file of [VAULT_FILE, VAULT_KEY_FILE]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (fs.existsSync(VAULT_DIR)) fs.rmSync(VAULT_DIR, { recursive: true, force: true });
}

beforeEach(() => {
  cleanupVaultFiles();
});

afterEach(() => {
  cleanupVaultFiles();
});

describe("credential vault (local-file fallback)", () => {
  it("reports the file backend as active when forced via config", async () => {
    const { getActiveVaultBackend } = await import("../security/vault");
    expect(getActiveVaultBackend()).toBe("file");
  });

  it("stores and retrieves a secret", async () => {
    const { getSecret, setSecret } = await import("../security/vault");

    await setSecret("test-account", "super-secret-value");
    expect(await getSecret("test-account")).toBe("super-secret-value");
  });

  it("returns undefined for a secret that was never set", async () => {
    const { getSecret } = await import("../security/vault");
    expect(await getSecret("never-set")).toBeUndefined();
  });

  it("overwrites an existing secret", async () => {
    const { getSecret, setSecret } = await import("../security/vault");

    await setSecret("rotating-account", "old-value");
    await setSecret("rotating-account", "new-value");
    expect(await getSecret("rotating-account")).toBe("new-value");
  });

  it("deletes a secret", async () => {
    const { getSecret, setSecret, deleteSecret } = await import("../security/vault");

    await setSecret("deletable-account", "value");
    expect(await deleteSecret("deletable-account")).toBe(true);
    expect(await getSecret("deletable-account")).toBeUndefined();
    expect(await deleteSecret("deletable-account")).toBe(false);
  });

  it("encrypts the vault file at rest (no plaintext secret on disk)", async () => {
    const { setSecret } = await import("../security/vault");

    await setSecret("plaintext-check", "do-not-leak-this-value");

    const raw = fs.readFileSync(VAULT_FILE, "utf8");
    expect(raw).not.toContain("do-not-leak-this-value");
  });
});

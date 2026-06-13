import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Force the local-file fallback backend so this test is deterministic in
// headless/CI environments without a Secret Service / Keychain daemon
// (PRD SEC-1, Phase 0 acceptance criterion #5).
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof import("../config")>("../config");
  return {
    ...actual,
    config: {
      ...actual.config,
      vaultBackend: "file",
      vaultDevPassphrase: "test-passphrase-for-vault-spec",
    },
  };
});

const VAULT_DIR = path.resolve(__dirname, "..", "data");
const VAULT_FILE = path.join(VAULT_DIR, ".jarvis-dev-vault.json");
const VAULT_KEY_FILE = path.join(VAULT_DIR, ".jarvis-dev-vault.key");

function cleanupVaultFiles(): void {
  for (const file of [VAULT_FILE, VAULT_KEY_FILE]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
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

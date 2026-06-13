// ---------------------------------------------------------------------------
// Credential vault (PRD SEC-1, Phase 0 deliverable #5).
//
// Primary backend: the OS-native keychain (macOS Keychain, Windows
// Credential Manager, Linux Secret Service) via the optional `keytar`
// package.
//
// Fallback backend (DEVELOPMENT/TESTING ONLY): an encrypted local file using
// AES-256-GCM via Node's built-in `crypto` module. This is used when:
//   - `JARVIS_VAULT_BACKEND=file` is set, OR
//   - `keytar` is unavailable (not installed, or failed to load - e.g. a
//     headless Linux/CI environment without a Secret Service daemon).
//
// Either way, the public API (`getSecret`/`setSecret`/`deleteSecret`) is the
// same, so callers never need to know which backend is active.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config, PROJECT_ROOT } from "../config";

const SERVICE_NAME = "jarvis";

/** Which backend the vault is actually using, decided lazily on first use. */
export type ActiveVaultBackend = "keychain" | "file";

interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let keytarModule: KeytarModule | null | undefined; // undefined = not yet probed

/** Lazily attempt to load `keytar`. Returns null if unavailable. */
function loadKeytar(): KeytarModule | null {
  if (keytarModule !== undefined) return keytarModule;

  if (config.vaultBackend === "file") {
    keytarModule = null;
    return keytarModule;
  }

  try {
    keytarModule = require("keytar") as KeytarModule;
  } catch {
    keytarModule = null;
  }

  return keytarModule;
}

// ---------------------------------------------------------------------------
// Local-file fallback vault
// ---------------------------------------------------------------------------

const VAULT_DIR = path.join(PROJECT_ROOT, "data");
const VAULT_FILE = path.join(VAULT_DIR, ".jarvis-dev-vault.json");
const VAULT_KEY_FILE = path.join(VAULT_DIR, ".jarvis-dev-vault.key");

interface EncryptedRecord {
  iv: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64
}

type VaultFileContents = Record<string, EncryptedRecord>;

/**
 * Resolve the symmetric key used to encrypt the local-file vault.
 *
 * If `JARVIS_VAULT_DEV_PASSPHRASE` is set, the key is derived from it
 * (scrypt). Otherwise, a random 32-byte key is generated on first use and
 * stored alongside the vault file - this is clearly dev-only, since anyone
 * with filesystem access can read both files.
 */
function getFileVaultKey(): Buffer {
  if (config.vaultDevPassphrase) {
    return crypto.scryptSync(config.vaultDevPassphrase, SERVICE_NAME, 32);
  }

  fs.mkdirSync(VAULT_DIR, { recursive: true });

  if (fs.existsSync(VAULT_KEY_FILE)) {
    return Buffer.from(fs.readFileSync(VAULT_KEY_FILE, "utf8"), "hex");
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(VAULT_KEY_FILE, key.toString("hex"), { mode: 0o600 });
  return key;
}

function readVaultFile(): VaultFileContents {
  if (!fs.existsSync(VAULT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(VAULT_FILE, "utf8")) as VaultFileContents;
  } catch {
    return {};
  }
}

function writeVaultFile(contents: VaultFileContents): void {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(VAULT_FILE, JSON.stringify(contents, null, 2), { mode: 0o600 });
}

function fileGetSecret(account: string): string | undefined {
  const contents = readVaultFile();
  const record = contents[account];
  if (!record) return undefined;

  const key = getFileVaultKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function fileSetSecret(account: string, secret: string): void {
  const key = getFileVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const contents = readVaultFile();
  contents[account] = {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  writeVaultFile(contents);
}

function fileDeleteSecret(account: string): boolean {
  const contents = readVaultFile();
  if (!(account in contents)) return false;
  delete contents[account];
  writeVaultFile(contents);
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Report which vault backend is currently active. */
export function getActiveVaultBackend(): ActiveVaultBackend {
  return loadKeytar() ? "keychain" : "file";
}

/** Retrieve a secret by account name. Returns undefined if not found. */
export async function getSecret(account: string): Promise<string | undefined> {
  const keytar = loadKeytar();
  if (keytar) {
    const value = await keytar.getPassword(SERVICE_NAME, account);
    return value ?? undefined;
  }
  return fileGetSecret(account);
}

/** Store (create or overwrite) a secret under the given account name. */
export async function setSecret(account: string, secret: string): Promise<void> {
  const keytar = loadKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE_NAME, account, secret);
    return;
  }
  fileSetSecret(account, secret);
}

/** Delete a secret. Returns true if a secret was removed. */
export async function deleteSecret(account: string): Promise<boolean> {
  const keytar = loadKeytar();
  if (keytar) {
    return keytar.deletePassword(SERVICE_NAME, account);
  }
  return fileDeleteSecret(account);
}

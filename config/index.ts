// ---------------------------------------------------------------------------
// JARVIS configuration loader.
//
// Reads environment variables (via dotenv, from a ".env" file in the project
// root if present) and exposes a single typed `config` object used by the
// rest of the app. Nothing here is required to be set for JARVIS to launch -
// see .env.example for details on "stub mode".
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Absolute path to the project root (the directory containing
 * `package.json`).
 *
 * Source files live at `<root>/<module>/file.ts` and compile to
 * `<root>/dist/<module>/file.js`, so `__dirname` is one level below the root
 * when running source directly (e.g. under vitest) but two levels below when
 * running compiled output (`dist/config/index.js`). Walking up until we find
 * `package.json` handles both cases without relying on `process.cwd()`.
 */
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir; // reached filesystem root; give up
    dir = parent;
  }
}

export const PROJECT_ROOT = findProjectRoot(__dirname);

// Load `.env` from the project root (no-op if the file doesn't exist).
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

/** Default model used for primary "reasoning" calls when unset. */
export const DEFAULT_MODEL_MAIN = "claude-sonnet-4-5";

/** Default model used for cheap/fast "routing" calls when unset. */
export const DEFAULT_MODEL_ROUTER = "claude-haiku-4-5";

/** Default monthly budget cap (USD) when unset. */
export const DEFAULT_MONTHLY_BUDGET_USD = 20;

/** Default path to the SQLite database file, relative to the project root. */
export const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, "data", "jarvis.db");

export type VaultBackend = "auto" | "keychain" | "file";

export type VoiceAdapter = "text" | "stub";

export interface JarvisConfig {
  /** Anthropic API key. If empty, the Brain runs in stub mode. */
  anthropicApiKey: string;
  /** Whether a real Anthropic API key is configured. */
  hasAnthropicApiKey: boolean;
  /** Model used for primary reasoning calls. */
  modelMain: string;
  /** Model used for cheap/fast routing calls. */
  modelRouter: string;
  /** Monthly budget cap in USD. */
  monthlyBudgetUsd: number;
  /** Credential vault backend selection. */
  vaultBackend: VaultBackend;
  /** Passphrase for the local-file vault fallback (dev/test only). */
  vaultDevPassphrase: string | undefined;
  /** Absolute path to the SQLite database file. */
  dbPath: string;
  /** Voice adapter selection (Phase 0 only supports "text"/"stub"). */
  voiceAdapter: VoiceAdapter;
}

function readVaultBackend(raw: string | undefined): VaultBackend {
  if (raw === "file" || raw === "keychain") return raw;
  return "auto";
}

function readVoiceAdapter(raw: string | undefined): VoiceAdapter {
  if (raw === "stub") return "stub";
  return "text";
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildConfig(env: NodeJS.ProcessEnv): JarvisConfig {
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";

  return {
    anthropicApiKey,
    hasAnthropicApiKey: anthropicApiKey.length > 0,
    modelMain: env.JARVIS_MODEL_MAIN?.trim() || DEFAULT_MODEL_MAIN,
    modelRouter: env.JARVIS_MODEL_ROUTER?.trim() || DEFAULT_MODEL_ROUTER,
    monthlyBudgetUsd: readNumber(env.JARVIS_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD),
    vaultBackend: readVaultBackend(env.JARVIS_VAULT_BACKEND?.trim()),
    vaultDevPassphrase: env.JARVIS_VAULT_DEV_PASSPHRASE?.trim() || undefined,
    dbPath: env.JARVIS_DB_PATH?.trim()
      ? path.resolve(env.JARVIS_DB_PATH.trim())
      : DEFAULT_DB_PATH,
    voiceAdapter: readVoiceAdapter(env.JARVIS_VOICE_ADAPTER?.trim()),
  };
}

/** The fully-resolved JARVIS configuration, loaded once at startup. */
export const config: JarvisConfig = buildConfig(process.env);

/**
 * Rebuild the config from a custom environment object. Exposed for tests so
 * they can exercise different env-var combinations without mutating
 * `process.env` for the whole process.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): JarvisConfig {
  return buildConfig(env);
}

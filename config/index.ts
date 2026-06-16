// ---------------------------------------------------------------------------
// JARVIS configuration loader.
//
// Reads environment variables (via dotenv, from a ".env" file in the project
// root if present) and exposes a single typed `config` object used by the
// rest of the app. Nothing here is required to be set for JARVIS to launch -
// see .env.example for details on "stub mode".
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
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

/**
 * Default IANA time zone used to resolve relative dates ("today", "this
 * week") when `JARVIS_TIME_ZONE` is unset (FR-3.5). Falls back to the host
 * system's configured time zone, which is always available (including in
 * headless/CI environments - it just defaults to UTC there).
 */
export const DEFAULT_TIME_ZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

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
  /**
   * Directory holding the local-file vault fallback's files
   * (`.jarvis-dev-vault.json` / `.jarvis-dev-vault.key`). Defaults to
   * `<PROJECT_ROOT>/data`. Overridable via `JARVIS_VAULT_DIR` so test suites
   * can point at isolated temp directories and avoid cross-file races on a
   * shared vault file.
   */
  vaultDir: string;
  /** Absolute path to the SQLite database file. */
  dbPath: string;
  /** Voice adapter selection (Phase 0 only supports "text"/"stub"). */
  voiceAdapter: VoiceAdapter;
  /**
   * IANA time zone (e.g. "America/New_York") used to resolve relative dates
   * like "today" (FR-3.5). Defaults to the host system's time zone.
   */
  timeZone: string;
  /**
   * Google OAuth 2.0 "Desktop app" client id, used by the Google Calendar
   * skill (skills/google-calendar). Empty string if not configured - the
   * skill then runs in stub mode (see skills/google-calendar/server.ts).
   */
  googleOAuthClientId: string;
  /** Google OAuth 2.0 client secret paired with googleOAuthClientId. */
  googleOAuthClientSecret: string;
  /**
   * Redirect URI registered for the Google OAuth "Desktop app" client.
   * Google's installed-app flow accepts the loopback redirect below by
   * default; only override this if you registered a different one.
   */
  googleOAuthRedirectUri: string;
  /** Whether both Google OAuth client id and secret are configured. */
  hasGoogleOAuthClient: boolean;
  /**
   * Stripe restricted API key (FR-5.1, SEC-2). Empty string if not
   * configured - the Stripe skill then runs in stub mode (see
   * skills/stripe/server.ts). Accepts either a secret key (`sk_...`) or a
   * restricted key (`rk_...`), test or live mode.
   */
  stripeApiKey: string;
  /** Whether a Stripe API key is configured. */
  hasStripeApiKey: boolean;
  /**
   * FR-5.6 / SEC-2 safety rail: by default, JARVIS refuses to call Stripe
   * with a key that does not look like a TEST-MODE key (`sk_test_`/
   * `rk_test_`). Set `STRIPE_ALLOW_LIVE_MODE=true` to explicitly opt into
   * live-mode calls with a `sk_live_`/`rk_live_` key. This is a deliberate,
   * separate config flag - never inferred or auto-enabled.
   */
  stripeAllowLiveMode: boolean;
  /**
   * FR-6.4: the single directory JARVIS's Local Filesystem skill is allowed
   * to read/write within (skills/filesystem). Defaults to
   * `~/Claude 2nd brain/JARVIS/`, derived via `os.homedir()` - never
   * hardcoded to a specific user's home directory. Overridable via
   * `JARVIS_ALLOWED_DIR` for testing or to point at a different folder.
   */
  allowedDirectory: string;
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

/** Default OAuth redirect URI for Google's "Desktop app" client type. */
export const DEFAULT_GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:53682/oauth2callback";

/**
 * Default allowed root directory for the Local Filesystem skill (FR-6.4):
 * `~/Claude 2nd brain/JARVIS/`, derived via `os.homedir()` so it never points
 * at a specific user's home directory by accident.
 */
export function defaultAllowedDirectory(): string {
  return path.join(os.homedir(), "Claude 2nd brain", "JARVIS");
}

function buildConfig(env: NodeJS.ProcessEnv): JarvisConfig {
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  const googleOAuthClientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const googleOAuthClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const stripeApiKey = (env.STRIPE_API_KEY ?? env.STRIPE_RESTRICTED_KEY)?.trim() ?? "";

  return {
    anthropicApiKey,
    hasAnthropicApiKey: anthropicApiKey.length > 0,
    modelMain: env.JARVIS_MODEL_MAIN?.trim() || DEFAULT_MODEL_MAIN,
    modelRouter: env.JARVIS_MODEL_ROUTER?.trim() || DEFAULT_MODEL_ROUTER,
    monthlyBudgetUsd: readNumber(env.JARVIS_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD),
    vaultBackend: readVaultBackend(env.JARVIS_VAULT_BACKEND?.trim()),
    vaultDevPassphrase: env.JARVIS_VAULT_DEV_PASSPHRASE?.trim() || undefined,
    vaultDir: env.JARVIS_VAULT_DIR?.trim()
      ? path.resolve(env.JARVIS_VAULT_DIR.trim())
      : path.join(PROJECT_ROOT, "data"),
    dbPath: env.JARVIS_DB_PATH?.trim()
      ? path.resolve(env.JARVIS_DB_PATH.trim())
      : DEFAULT_DB_PATH,
    voiceAdapter: readVoiceAdapter(env.JARVIS_VOICE_ADAPTER?.trim()),
    timeZone: env.JARVIS_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE,
    googleOAuthClientId,
    googleOAuthClientSecret,
    googleOAuthRedirectUri:
      env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || DEFAULT_GOOGLE_OAUTH_REDIRECT_URI,
    hasGoogleOAuthClient: googleOAuthClientId.length > 0 && googleOAuthClientSecret.length > 0,
    stripeApiKey,
    hasStripeApiKey: stripeApiKey.length > 0,
    stripeAllowLiveMode: (env.STRIPE_ALLOW_LIVE_MODE?.trim().toLowerCase() ?? "") === "true",
    allowedDirectory: env.JARVIS_ALLOWED_DIR?.trim()
      ? path.resolve(env.JARVIS_ALLOWED_DIR.trim())
      : defaultAllowedDirectory(),
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

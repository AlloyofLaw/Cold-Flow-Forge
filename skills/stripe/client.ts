// ---------------------------------------------------------------------------
// Stripe client construction + TEST-MODE safety rail (PRD Section 6.5,
// FR-5.1, FR-5.6, SEC-2).
//
// Unlike Google Calendar/Gmail, Stripe access is via a single restricted API
// key (a string), not OAuth. The key is read from config (env var
// STRIPE_API_KEY / STRIPE_RESTRICTED_KEY, see config/index.ts) and/or the
// credential vault (security/vault.ts), mirroring the vault pattern used for
// OAuth tokens elsewhere - storing the key in the vault lets a future
// Integrations panel update it without editing `.env`.
//
// FR-5.6 / SEC-2 HARD REQUIREMENT: JARVIS defaults to Stripe TEST MODE.
// Stripe test-mode keys start with `sk_test_` or `rk_test_`; live-mode keys
// start with `sk_live_` or `rk_live_`. If the configured key does NOT look
// like a test-mode key, `getStripeClient()` REFUSES to build a client
// (logs a clear error and returns `undefined`, which server.ts treats as
// stub mode) UNLESS `STRIPE_ALLOW_LIVE_MODE=true` is explicitly set. This is
// a real safety rail, not a comment - no live-mode call can happen by
// accident.
//
// Stub mode: if no Stripe key is configured at all, `getStripeClient()`
// returns `undefined` and server.ts falls back to clearly-labeled stub
// responses with zero network calls.
// ---------------------------------------------------------------------------

import Stripe from "stripe";
import { config } from "../../config";
import { getSecret, setSecret } from "../../security/vault";

/** Vault account name under which a Stripe API key can be stored. */
export const STRIPE_KEY_VAULT_ACCOUNT = "stripe-api-key";

/** API version pinned for stability (Stripe Node SDK requires this to be a literal). */
const STRIPE_API_VERSION = "2025-08-27.basil" as const;

/**
 * Whether `key` looks like a Stripe TEST-MODE key (FR-5.6). Recognizes both
 * secret (`sk_test_...`) and restricted (`rk_test_...`) test keys.
 */
export function isTestModeKey(key: string): boolean {
  return /^[sr]k_test_/.test(key);
}

/**
 * Whether `key` looks like a Stripe LIVE-MODE key. Recognizes both secret
 * (`sk_live_...`) and restricted (`rk_live_...`) live keys.
 */
export function isLiveModeKey(key: string): boolean {
  return /^[sr]k_live_/.test(key);
}

/**
 * Resolve the Stripe API key to use: config (env) takes precedence, falling
 * back to a key stored in the credential vault (e.g. saved via a future
 * Integrations panel). Returns `undefined` if neither is configured.
 */
export async function resolveStripeApiKey(): Promise<string | undefined> {
  if (config.hasStripeApiKey) return config.stripeApiKey;

  const stored = await getSecret(STRIPE_KEY_VAULT_ACCOUNT);
  return stored && stored.length > 0 ? stored : undefined;
}

/** Persist a Stripe API key to the credential vault (for a future Integrations panel). */
export async function storeStripeApiKey(key: string): Promise<void> {
  await setSecret(STRIPE_KEY_VAULT_ACCOUNT, key);
}

/**
 * Build a Stripe client, enforcing the FR-5.6/SEC-2 test-mode safety rail.
 *
 * Returns `undefined` (stub mode) if:
 *   - no Stripe API key is configured, OR
 *   - the configured key looks like a LIVE-MODE key and
 *     `STRIPE_ALLOW_LIVE_MODE=true` has NOT been set - in this case a clear
 *     warning is logged so the user understands why Stripe tools are
 *     returning stub data.
 *
 * A key that is neither recognizably test-mode nor live-mode (e.g. a
 * malformed value) is also refused, defaulting to the safer "no client"
 * outcome.
 */
export async function getStripeClient(): Promise<Stripe | undefined> {
  const apiKey = await resolveStripeApiKey();
  if (!apiKey) return undefined;

  if (isTestModeKey(apiKey)) {
    return new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });
  }

  if (isLiveModeKey(apiKey)) {
    if (config.stripeAllowLiveMode) {
      return new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });
    }

    console.error(
      "[stripe] Refusing to use a LIVE-MODE Stripe key because STRIPE_ALLOW_LIVE_MODE is not set to " +
        "'true' (FR-5.6 / SEC-2). JARVIS defaults to Stripe TEST MODE for safety. The Stripe skill " +
        "will run in stub mode until a sk_test_/rk_test_ key is configured, or you explicitly set " +
        "STRIPE_ALLOW_LIVE_MODE=true (not recommended until you trust the integration).",
    );
    return undefined;
  }

  // Doesn't look like a recognized Stripe key shape at all - refuse rather
  // than guess.
  console.error(
    "[stripe] The configured Stripe API key does not look like a valid sk_/rk_ test or live key. " +
      "The Stripe skill will run in stub mode.",
  );
  return undefined;
}

/**
 * Whether the currently-configured Stripe key (if any) is in TEST mode.
 * Used by server.ts to label stub/real responses and by tests. Returns
 * `undefined` if no key is configured at all.
 */
export async function isConfiguredKeyTestMode(): Promise<boolean | undefined> {
  const apiKey = await resolveStripeApiKey();
  if (!apiKey) return undefined;
  return isTestModeKey(apiKey);
}

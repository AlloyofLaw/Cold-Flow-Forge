// ---------------------------------------------------------------------------
// TOTP second-factor for Tier 3 confirmations (PRD R-2a, SEC-6).
//
// R-2a / SEC-6: Tier 3 actions (Stripe refunds, subscription cancellations,
// permanent file deletion, etc.) require BOTH a spoken/UI "confirm" (R-2)
// AND a 6-digit TOTP code from an authenticator app (e.g. Google
// Authenticator), entered in the UI - NEVER spoken, since a recording could
// capture a spoken code.
//
// Setup is one-time: `generateTotpSecret()` creates a new secret, stores it
// in the credential vault (security/vault.ts, mirroring the
// getSecret/setSecret pattern used by skills/stripe/client.ts), and returns
// a setup URI (`otpauth://...`, suitable for rendering as a QR code) plus the
// raw base32 secret (for manual entry into an authenticator app).
//
// `verifyTotpCode()` checks a 6-digit code against the stored secret, with
// the standard +/-1 step window for clock drift.
// If no secret has been configured yet, verification FAILS CLOSED (returns
// false) - Tier 3 actions simply cannot proceed until setup is done. This
// must be surfaced to the user clearly (see
// `TOTP_NOT_CONFIGURED_MESSAGE`/core/permissions.ts), not a silent failure.
//
// otplib v13 uses a functional API (generateSecret/generateURI/generate/
// verify), not the older `authenticator` singleton from v11/v12.
// ---------------------------------------------------------------------------

import { generateSecret, generateURI, generate, verify } from "otplib";
import { getSecret, setSecret } from "./vault";

/** Vault account name under which the TOTP secret is stored (R-2a). */
export const TOTP_SECRET_VAULT_ACCOUNT = "totp-secret";

/** Issuer/label shown in the authenticator app. */
const TOTP_ISSUER = "JARVIS";
const TOTP_ACCOUNT_LABEL = "andrew";

/**
 * +/-1 step (~30s each way) window for clock drift, per R-2a. otplib v13's
 * functional `verify()` expresses this as an `epochTolerance` in seconds
 * (one TOTP step = 30s) rather than a step count.
 */
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

export interface TotpSetup {
  /** Raw base32 secret, for manual entry into an authenticator app. */
  secret: string;
  /** `otpauth://...` URI, suitable for rendering as a QR code. */
  uri: string;
}

/**
 * One-time setup: generate a new TOTP secret, persist it to the credential
 * vault, and return both the manually-typeable base32 secret and an
 * `otpauth://` setup URI for a QR code. Calling this again generates a NEW
 * secret and overwrites the old one (re-running setup invalidates any
 * previously-configured authenticator entry).
 */
export async function generateTotpSecret(): Promise<TotpSetup> {
  const secret = await generateSecret();
  await setSecret(TOTP_SECRET_VAULT_ACCOUNT, secret);

  const uri = await generateURI({ secret, label: TOTP_ACCOUNT_LABEL, issuer: TOTP_ISSUER, strategy: "totp" });

  return { secret, uri };
}

/** Whether a TOTP secret has been configured (setup has been run at least once). */
export async function isTotpConfigured(): Promise<boolean> {
  const secret = await getSecret(TOTP_SECRET_VAULT_ACCOUNT);
  return typeof secret === "string" && secret.length > 0;
}

/**
 * Verify a 6-digit TOTP code against the stored secret (R-2a). Allows the
 * standard +/-1 step window for clock drift.
 *
 * Fails closed: if no secret has been configured yet, OR `code` is not a
 * valid 6-digit string, returns `false` - Tier 3 actions cannot execute
 * without a configured + verified TOTP.
 */
export async function verifyTotpCode(code: string): Promise<boolean> {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;

  const secret = await getSecret(TOTP_SECRET_VAULT_ACCOUNT);
  if (!secret) return false;

  try {
    const result = await verify({
      secret,
      token: code,
      strategy: "totp",
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Test/dev helper: compute the current valid TOTP code for a given secret
 * (mirrors what an authenticator app would display). Used by tests to
 * compute a valid code without needing a real authenticator app.
 */
export async function generateTotpCode(secret: string): Promise<string> {
  return generate({ secret, strategy: "totp" });
}

/**
 * Plain-language message shown when a Tier 3 action is requested but no TOTP
 * secret has been configured yet (R-2a). Used by core/permissions.ts /
 * core/agent.ts to surface this clearly rather than silently failing.
 */
export const TOTP_NOT_CONFIGURED_MESSAGE =
  "Two-factor confirmation (Google Authenticator) is not set up yet. This action requires Tier 3 " +
  "confirmation, which needs a TOTP code in addition to your confirm/cancel - see README 'Set up " +
  "two-factor confirmation' to run the one-time setup before this action can proceed.";

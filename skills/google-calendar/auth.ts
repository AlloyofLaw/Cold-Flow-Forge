// ---------------------------------------------------------------------------
// Google OAuth 2.0 (desktop/installed-app flow) for the Google Calendar
// skill (PRD Section 6.3, SEC-1, SEC-2).
//
// Scope: READ-ONLY ONLY. This skill must never request a broader scope than
// `calendar.readonly` - Phase 1 has no event-write tools, and the OAuth
// consent screen the user approves should reflect that.
//
// Credentials and tokens:
//   - The OAuth *client* id/secret (created once by the user in Google Cloud
//     Console, see README "Connect your Google Calendar") come from env vars
//     via config/index.ts (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).
//     These identify *this app*, not the user, and are not secret in the same
//     sense as a user's access/refresh tokens - but per SEC-1 we still never
//     write them to a committed file.
//   - The OAuth *tokens* (access + refresh token) resulting from the user's
//     one-time authorization are stored in the credential vault
//     (security/vault.ts), never in the repo or a plain config file.
//
// Stub mode: if the OAuth client id/secret are not configured
// (`config.hasGoogleOAuthClient === false`), `getCalendarAuth()` returns
// `undefined` and the calling server (server.ts) falls back to stub
// responses. This lets the whole app start and `npm test` pass with zero
// Google account (PRD Phase 1 "Graceful stub mode").
// ---------------------------------------------------------------------------

// Imported from `googleapis-common` (not the top-level `google-auth-library`
// package) so the `OAuth2Client` type matches what `googleapis`'s
// `google.calendar({ auth })` expects - `googleapis` resolves its `auth`
// parameter types against `googleapis-common`'s bundled copy of
// `google-auth-library`, which can be a different version than the
// top-level one.
import { OAuth2Client } from "googleapis-common";
import { config } from "../../config";
import { getSecret, setSecret } from "../../security/vault";

/**
 * The ONLY scope this skill ever requests. Phase 1 is read-only end-to-end
 * (PRD hard requirement) - do not add write scopes here without also adding
 * write tools, tier assignments, and the confirmation flow (Phase 2+).
 */
export const CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/** Vault account name under which the user's OAuth tokens are stored. */
export const CALENDAR_TOKEN_VAULT_ACCOUNT = "google-calendar-oauth-tokens";

/** Shape of the token JSON persisted in the vault (subset of google-auth-library's Credentials). */
export interface StoredCalendarTokens {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

/**
 * Build an OAuth2Client for the Calendar skill, loading any previously
 * stored tokens from the vault and persisting refreshed tokens back to it.
 *
 * Returns `undefined` if no OAuth client id/secret is configured - the
 * server should treat this as "stub mode" (no Google account connected
 * yet).
 */
export async function getCalendarAuth(): Promise<OAuth2Client | undefined> {
  if (!config.hasGoogleOAuthClient) return undefined;

  const client = new OAuth2Client({
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    redirectUri: config.googleOAuthRedirectUri,
  });

  const storedJson = await getSecret(CALENDAR_TOKEN_VAULT_ACCOUNT);
  if (storedJson) {
    try {
      const tokens = JSON.parse(storedJson) as StoredCalendarTokens;
      client.setCredentials(tokens);
    } catch {
      // Corrupt/unreadable stored tokens - treat as "not yet authorized".
      // The user will need to re-run the one-time authorization (README).
    }
  }

  // SEC-4: persist refreshed tokens (Google rotates the access token using
  // the stored refresh token) so the next run doesn't need re-authorization.
  client.on("tokens", (tokens) => {
    void persistTokens(client, tokens);
  });

  return client;
}

/** Convert google-auth-library's `Credentials` (nullable fields) to our stored shape. */
function toStoredTokens(credentials: {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
}): StoredCalendarTokens {
  return {
    access_token: credentials.access_token ?? undefined,
    refresh_token: credentials.refresh_token ?? undefined,
    scope: credentials.scope ?? undefined,
    token_type: credentials.token_type ?? undefined,
    expiry_date: credentials.expiry_date ?? undefined,
  };
}

async function persistTokens(
  client: OAuth2Client,
  newTokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    scope?: string | null;
    token_type?: string | null;
    expiry_date?: number | null;
  },
): Promise<void> {
  // Merge at the raw-credentials level first (Google's refresh response
  // typically omits `refresh_token`, since it doesn't rotate) so a `null`
  // in `newTokens` doesn't blow away a previously-stored value once
  // normalized.
  const merged = toStoredTokens({ ...client.credentials, ...newTokens });
  await setSecret(CALENDAR_TOKEN_VAULT_ACCOUNT, JSON.stringify(merged));
}

/**
 * Whether the user has completed the one-time OAuth authorization (i.e. we
 * have at least a refresh token stored). Does not validate the token against
 * Google - a revoked/expired token still reports `true` here but will fail
 * on the next API call (handled by server.ts, SEC-4 / Edge Cases table).
 */
export async function hasStoredCalendarTokens(): Promise<boolean> {
  const storedJson = await getSecret(CALENDAR_TOKEN_VAULT_ACCOUNT);
  if (!storedJson) return false;
  try {
    const tokens = JSON.parse(storedJson) as StoredCalendarTokens;
    return Boolean(tokens.refresh_token || tokens.access_token);
  } catch {
    return false;
  }
}

/**
 * Generate the URL the user opens in a browser to authorize JARVIS
 * (installed-app flow, README "one-time authorization" step). Returns
 * `undefined` in stub mode (no OAuth client configured).
 */
export function getAuthorizationUrl(): string | undefined {
  if (!config.hasGoogleOAuthClient) return undefined;

  const client = new OAuth2Client({
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    redirectUri: config.googleOAuthRedirectUri,
  });

  return client.generateAuthUrl({
    access_type: "offline", // request a refresh token
    scope: [CALENDAR_READONLY_SCOPE],
    prompt: "consent",
  });
}

/**
 * Complete the one-time authorization by exchanging the `code` from
 * Google's redirect for tokens, and store them in the vault. Used by the
 * (documented, manual) one-time setup step - see README "Connect your
 * Google Calendar".
 */
export async function exchangeAuthorizationCode(code: string): Promise<void> {
  if (!config.hasGoogleOAuthClient) {
    throw new Error("Google OAuth client id/secret are not configured (stub mode).");
  }

  const client = new OAuth2Client({
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    redirectUri: config.googleOAuthRedirectUri,
  });

  const { tokens } = await client.getToken(code);
  await setSecret(CALENDAR_TOKEN_VAULT_ACCOUNT, JSON.stringify(tokens));
}

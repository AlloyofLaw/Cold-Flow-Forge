// ---------------------------------------------------------------------------
// Google OAuth 2.0 (desktop/installed-app flow) for the Gmail skill
// (PRD Section 6.4, SEC-1, SEC-2).
//
// Scopes requested:
//   - https://www.googleapis.com/auth/gmail.readonly  (search/read mail)
//   - https://www.googleapis.com/auth/gmail.compose   (create drafts)
//
// `gmail.compose` covers creating, reading, and SENDING drafts/messages
// (gmail.users.messages.send and gmail.users.drafts.send are both within
// this scope), so Phase 3's `send_email` tool (Tier 2, FR-4.4) needs NO
// scope upgrade - this remains the narrowest scope combination that
// supports drafting AND sending. Least privilege is enforced at the TOOL
// layer (SEC-2): every send is Tier 2 and ALWAYS requires confirmation
// (core/permissions.ts). Never request `gmail.modify` or full
// `mail.google.com` access.
//
// Credentials and tokens:
//   - Reuses the SAME Google OAuth *client* id/secret as the Calendar skill
//     (config/index.ts GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) -
//     one Google Cloud OAuth client can request multiple scopes/products.
//   - The Gmail OAuth *tokens* (access + refresh token) are stored
//     separately from the Calendar tokens in the credential vault
//     (security/vault.ts), under their own account name, so disconnecting
//     one skill never affects the other (FR-7.3).
//
// Stub mode: if the OAuth client id/secret are not configured
// (`config.hasGoogleOAuthClient === false`), `getGmailAuth()` returns
// `undefined` and the calling server (server.ts) falls back to stub
// responses, mirroring skills/google-calendar/auth.ts.
// ---------------------------------------------------------------------------

import { OAuth2Client } from "googleapis-common";
import { config } from "../../config";
import { getSecret, setSecret } from "../../security/vault";

/**
 * Scopes this skill requests. `gmail.readonly` covers search/read
 * (FR-4.2); `gmail.compose` covers draft creation (FR-4.3). No send/modify
 * scope is requested, and no send tool exists (Phase 3 per PRD Section 14).
 */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const GMAIL_SCOPES = [GMAIL_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE] as const;

/** Vault account name under which the user's Gmail OAuth tokens are stored. */
export const GMAIL_TOKEN_VAULT_ACCOUNT = "google-gmail-oauth-tokens";

/** Shape of the token JSON persisted in the vault (subset of google-auth-library's Credentials). */
export interface StoredGmailTokens {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

/**
 * Build an OAuth2Client for the Gmail skill, loading any previously stored
 * tokens from the vault and persisting refreshed tokens back to it.
 *
 * Returns `undefined` if no OAuth client id/secret is configured - the
 * server should treat this as "stub mode" (no Gmail account connected yet).
 */
export async function getGmailAuth(): Promise<OAuth2Client | undefined> {
  if (!config.hasGoogleOAuthClient) return undefined;

  const client = new OAuth2Client({
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    redirectUri: config.googleOAuthRedirectUri,
  });

  const storedJson = await getSecret(GMAIL_TOKEN_VAULT_ACCOUNT);
  if (storedJson) {
    try {
      const tokens = JSON.parse(storedJson) as StoredGmailTokens;
      client.setCredentials(tokens);
    } catch {
      // Corrupt/unreadable stored tokens - treat as "not yet authorized".
    }
  }

  // SEC-4: persist refreshed tokens so the next run doesn't need re-authorization.
  client.on("tokens", (tokens) => {
    void persistTokens(client, tokens);
  });

  return client;
}

function toStoredTokens(credentials: {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
}): StoredGmailTokens {
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
  const merged = toStoredTokens({ ...client.credentials, ...newTokens });
  await setSecret(GMAIL_TOKEN_VAULT_ACCOUNT, JSON.stringify(merged));
}

/**
 * Whether the user has completed the one-time Gmail OAuth authorization
 * (i.e. we have at least a refresh token stored). Does not validate the
 * token against Google.
 */
export async function hasStoredGmailTokens(): Promise<boolean> {
  const storedJson = await getSecret(GMAIL_TOKEN_VAULT_ACCOUNT);
  if (!storedJson) return false;
  try {
    const tokens = JSON.parse(storedJson) as StoredGmailTokens;
    return Boolean(tokens.refresh_token || tokens.access_token);
  } catch {
    return false;
  }
}

/**
 * Generate the URL the user opens in a browser to authorize JARVIS's Gmail
 * access (installed-app flow, README "Connect Gmail"). Returns `undefined`
 * in stub mode (no OAuth client configured).
 */
export function getGmailAuthorizationUrl(): string | undefined {
  if (!config.hasGoogleOAuthClient) return undefined;

  const client = new OAuth2Client({
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    redirectUri: config.googleOAuthRedirectUri,
  });

  return client.generateAuthUrl({
    access_type: "offline",
    scope: [...GMAIL_SCOPES],
    prompt: "consent",
  });
}

/**
 * Complete the one-time Gmail authorization by exchanging the `code` from
 * Google's redirect for tokens, and store them in the vault (README
 * "Connect Gmail").
 */
export async function exchangeGmailAuthorizationCode(code: string): Promise<void> {
  if (!config.hasGoogleOAuthClient) {
    throw new Error("Google OAuth client id/secret are not configured (stub mode).");
  }

  const client = new OAuth2Client({
    clientId: config.googleOAuthClientId,
    clientSecret: config.googleOAuthClientSecret,
    redirectUri: config.googleOAuthRedirectUri,
  });

  const { tokens } = await client.getToken(code);
  await setSecret(GMAIL_TOKEN_VAULT_ACCOUNT, JSON.stringify(tokens));
}

# Security audit — yahoo-mail-mcp-server

**Upstream:** https://github.com/jtokib/yahoo-mail-mcp-server
**Commit audited:** `c1ced5a4dfd3cdbf1130225a2c8799323adbff52` (v3.0.0, 2025-12-18)
**Audited:** 2026-08-12
**Verdict:** No malicious code. Safe to run locally over stdio. Several real
authentication defects in the remote/SSE mode, patched in this vendored copy.

---

## 1. Malware review — clean

The whole of `server.js` (1,699 lines), the lockfile, `Dockerfile`,
`docker-compose.yml`, `render.yaml` and the docs were reviewed.

| Check | Result |
|---|---|
| Outbound network destinations | Only `imap.mail.yahoo.com:993`. No HTTP client of any kind — no `fetch`, `axios`, `http.request`, `net.connect`, or `dgram`. |
| Code execution primitives | None. No `eval`, `new Function`, `child_process`, `exec`, `spawn`, or dynamic `require` of remote content. |
| Obfuscation | None. No packed, minified, or base64-encoded payloads. The `Buffer.from(...).toString('base64')` calls were OAuth token generation. |
| npm lifecycle scripts | None in `package.json`. Across all 187 packages, only `fsevents` has an install script — the standard dev-only, macOS-only, optional dependency. |
| Dependency provenance | All 187 packages resolve to `registry.npmjs.org`. No private registries, git URLs, tarball URLs, or typosquat-style names. |
| TLS to Yahoo | Correct: `rejectUnauthorized: true`, `minVersion: TLSv1.2`, explicit `servername`. |
| Credentials in git | None. No `.env` or credential file appears anywhere in the file history. `.gitignore` correctly excludes them. |
| Prompt-injection payloads in docs | None found. |

**Tool scope is inherently limited**, which caps the blast radius of a bad tool
call: there is no send-email tool and no permanent-delete tool. `delete_emails`
performs an IMAP move to `Trash`, so it is recoverable.

### Trust signals

Small personal project — 18 stars, single author, last commit Dec 2025. The
code is clean *at this commit*; there is no ongoing audit or review process
upstream. This vendored copy is pinned to the audited commit deliberately.
Re-audit before taking any upstream update.

---

## 2. Defects found and fixed

All of these are reachable only in `TRANSPORT_MODE=sse` (the HTTP/remote mode).
None are reachable in `stdio` mode, where Express never listens.

### 2.1 Fail-open authentication — critical

`server.js:1313` — if `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` were unset, the
auth middleware logged a warning and called `next()` anyway. The server started
happily. Any internet-reachable deployment in that state exposed the entire
mailbox — readable and deletable — to anyone who found the URL.

Made worse by 2.2: upstream `render.yaml` did not list the OAuth variables at
all, so following the project's own deploy instructions produced exactly this
state.

**Fixed:** the server now `process.exit(1)`s at startup in SSE mode when OAuth
is unconfigured, and the middleware returns `503` rather than passing the
request through. `ALLOW_UNAUTHENTICATED=true` is an explicit, loudly-warned
escape hatch for local testing only.

### 2.2 Deploy config omitted the OAuth variables — high

`render.yaml` declared `YAHOO_EMAIL` and `YAHOO_APP_PASSWORD` but not
`OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET`.

**Fixed:** both added with `sync: false` and a comment explaining they are
mandatory.

### 2.3 `redirect_uri` validated by substring — high

`server.js:1431` used `redirect_uri.includes('claude.ai')`, which accepts
`https://claude.ai.attacker.example/steal` and `https://evil.example/?x=claude.ai`.
Exploitation also required the client secret at the token exchange, so this was
not directly sufficient for takeover, but it is the wrong check.

**Fixed:** `isAllowedRedirectUri()` parses the URL and matches the hostname
exactly against `claude.ai` / `claude.com` (plus subdomains), requires HTTPS for
non-loopback hosts, and permits `localhost` / `127.0.0.1` / `::1` for local dev.
Verified against 9 cases including all the bypasses above.

### 2.4 Access tokens never expired — high

Tokens went into a plain `Set` that was never pruned, so a token remained valid
until process restart despite the response advertising `expires_in: 3600`. The
set also grew without bound.

**Fixed:** tokens are stored in a `Map` of token → expiry and checked on every
request; expired entries are pruned on issue and deleted on use.

### 2.5 Guessable authorization codes and tokens — moderate

Both were `Buffer.from(`${client_id}:${Date.now()}:${Math.random()}`)
.toString('base64')`. `Math.random()` is not a CSPRNG, and the value decodes to
reveal the client ID and issue time.

**Fixed:** both are now `crypto.randomBytes(32).toString('base64url')`.

### 2.6 Authorization codes never expired; PKCE was optional — moderate

`created_at` was stored but never checked, so a code stayed valid indefinitely.
PKCE was only verified `if (authData.code_challenge)` — a request that simply
omitted `code_challenge` skipped the check entirely.

**Fixed:** PKCE with `code_challenge_method=S256` is now required at
`/oauth/authorize`; codes expire after 60 seconds, are burned before validation
so a failed exchange cannot be retried, and `redirect_uri` must match the value
the code was issued for.

### 2.7 Credential comparison not constant-time — low

`client_id` and `client_secret` were compared with `!==`.

**Fixed:** constant-time comparison via `crypto.timingSafeEqual` with a length
guard (`safeEqual()`).

### 2.8 Cross-session message routing — moderate

`server.js:1642` — a `POST /mcp/message` with no matching session ID fell back
to "the first available transport". With more than one client connected, that
routes one caller's message into another caller's session.

**Fixed:** the fallback is removed; unmatched sessions get a `404`.

### 2.9 CORS allowed all origins with credentials — moderate

`cors({ origin: true, credentials: true })` lets any web page a browser visits
issue credentialed requests to the server.

**Fixed:** origin is validated with the same allowlist as `redirect_uri`.
Requests with no `Origin` header (non-browser clients) still pass and are
governed by bearer auth.

### 2.10 dotenv banner corrupted the stdio JSON-RPC stream — low, affects stdio

dotenv v17 writes a startup tip to **stdout**, which in stdio mode is the
JSON-RPC framing channel. Confirmed empirically: a non-JSON line preceded the
first protocol message.

**Fixed:** `dotenv.config({ quiet: true })`. This is the one fix that matters
for local stdio use.

### 2.11 Dependency advisories — 13 (9 high), all DoS

`path-to-regexp` (ReDoS ×3), `picomatch` (ReDoS, method injection), `qs`
(3 DoS) — all transitive through Express, all reachable only in HTTP mode.

**Fixed:** `npm audit fix` → express 4.22.2, qs 6.15.3, path-to-regexp 0.1.13,
picomatch 2.3.2. **0 vulnerabilities** remain.

---

## 3. Residual risks — not fixable in code

1. **The Yahoo app password grants full IMAP access** to the mailbox and is held
   in plaintext in the environment. Scope it to this use, and revoke it at
   https://login.yahoo.com/account/security if it is ever exposed.
2. **Prompt injection via email content.** Any email-reading MCP pipes attacker
   controlled text into the model's context, and this server also exposes
   delete / move / archive tools. A hostile email can attempt to steer the
   assistant into using them. Mitigating factors: no send tool, no permanent
   delete. Treat tool-call confirmations on this server as security decisions.
3. **Single-maintainer upstream.** Pinned to the audited commit; re-audit any
   update.

---

## 4. Verification performed

- `node --check server.js` — passes.
- stdio handshake: `initialize` + `tools/list` returns all 11 tools, stdout is
  pure JSON-RPC after the dotenv fix.
- SSE without OAuth configured: exits 1 with a FATAL message.
- `/mcp/sse` with no token → 401; bogus token → 401; valid token → 200.
- `/oauth/token` wrong secret → 401; correct secret → 200, `expires_in: 3600`,
  43-char random token.
- `/oauth/authorize` hostile `redirect_uri` → 400; missing PKCE → 400; valid
  request → 302 with a random code.
- `/mcp/message` with a valid token but no session → 404 (no cross-session
  fallback).
- `isAllowedRedirectUri()` — 9/9 cases including `claude.ai.attacker.example`,
  `evil.example/?x=claude.ai`, `notclaude.ai`, `http://claude.ai`, and
  `javascript:` scheme.
- `npm audit` — 0 vulnerabilities.

# JARVIS (Phase 1: First Skill - Google Calendar)

JARVIS is a voice-first personal AI agent that runs on your own computer. This
repository is the **Phase 1** build: a runnable desktop app with a chat
window, an activity log, all the local plumbing from Phase 0 (database,
credential vault, permission framework), and JARVIS's first connected skill -
a **read-only Google Calendar** integration so you can ask things like "what's
on my calendar today?". **No accounts or API keys are required to run it** -
everything works in a clearly-labeled "stub mode" out of the box.

See `PRD-JARVIS.md` for the full product plan. This README covers getting
JARVIS running, with or without a Google account connected.

---

## 1. What you need installed

- **Node.js 22 or newer** - https://nodejs.org (this gives you `node` and `npm`)

That's it. Everything else is installed automatically by `npm install`.

---

## 2. First-time setup

Open a terminal in this folder and run:

```bash
npm install
npm start
```

`npm start` builds the project and opens the JARVIS desktop window. The first
run will:

- Create a local SQLite database at `data/jarvis.db` (this stores the
  conversation history, activity log, cost tracking, and settings - all on
  your machine, never sent anywhere).
- Create a local credential vault file under `data/` if your OS keychain
  isn't available (more on this below).

You should see a window titled **JARVIS** with a conversation box on the left
and a status / activity log panel on the right.

### Try it out

Type a message in the box at the bottom and press **Send**. Since no
Anthropic API key is configured yet, JARVIS will reply with a message starting
`[STUB REPLY - no ANTHROPIC_API_KEY configured]` that simply echoes back what
you typed. This confirms the whole pipeline works: your message and JARVIS's
reply are both saved, and a new line appears in the **Activity Log** on the
right showing the exchange was logged at **Tier 0 (Read-only)**.

---

## 3. Adding a real API key (optional, for real responses)

To have JARVIS actually think (using a Claude model) instead of echoing a
stub reply:

1. Get an API key from https://console.anthropic.com/ (Settings -> API Keys).
2. Copy `.env.example` to a new file named `.env` in this same folder.
3. Open `.env` in any text editor and paste your key after `ANTHROPIC_API_KEY=`.
4. Save the file and restart JARVIS (`npm start` again).

The status panel will now show "Connected to \<model name\>" instead of "Stub
mode", and the cost meter will start tracking estimated spend per the monthly
budget cap (`JARVIS_MONTHLY_BUDGET_USD` in `.env.example`, default $20).

**`.env` is never committed to git** - it's in `.gitignore`. Only put real
secrets in `.env`, never in any file you might commit.

---

## 4. Connect your Google Calendar (optional)

JARVIS can read your Google Calendar so it can answer questions like "what's
on my calendar today?" or "when's my next meeting?". This is **read-only** -
JARVIS can only ever *view* your calendars and events. It can never create,
edit, delete, or respond to anything on your calendar (in this phase or any
future one, without a separate code change and a new permission).

If you skip this section, JARVIS still works - the calendar tools simply
return a clearly-labeled "no calendar connected yet" placeholder.

### Step 1: Create a Google Cloud OAuth client

1. Go to https://console.cloud.google.com/ and sign in with the Google
   account whose calendar you want JARVIS to read.
2. If you don't already have a project, create one (any name is fine, e.g.
   "JARVIS").
3. In the left sidebar, go to **APIs & Services -> Library**, search for
   **"Google Calendar API"**, and click **Enable**.
4. Go to **APIs & Services -> OAuth consent screen**:
   - Choose **External** (unless you have a Google Workspace org and prefer
     **Internal**).
   - Fill in the required fields (app name, your email). You don't need to
     submit this for verification - it's fine to leave it in "Testing" mode
     since only you will use it.
   - Under **Scopes**, you don't need to add anything here - JARVIS requests
     its scope directly when you authorize it (Step 3 below).
   - Under **Test users** (if the app is in "Testing" mode), add the Google
     account you signed in with in Step 1.
5. Go to **APIs & Services -> Credentials -> Create Credentials -> OAuth
   client ID**:
   - Application type: **Desktop app**.
   - Name: anything, e.g. "JARVIS Desktop".
   - Click **Create**. Google will show you a **Client ID** and **Client
     secret** - keep this page open, you'll need both in the next step.

### Step 2: Add the client id/secret to JARVIS

1. Copy `.env.example` to `.env` if you haven't already (see Section 3).
2. Open `.env` and fill in the two values from Step 1:
   ```
   GOOGLE_OAUTH_CLIENT_ID=your-client-id-here
   GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret-here
   ```
3. Leave `GOOGLE_OAUTH_REDIRECT_URI` blank unless you specifically configured
   a different redirect URI on the OAuth client - the default
   (`http://localhost:53682/oauth2callback`) matches what Google's "Desktop
   app" client type expects automatically.
4. (Optional) Set `JARVIS_TIME_ZONE` to your IANA time zone (e.g.
   `America/New_York`, `Europe/London`) if it's different from the time zone
   your computer is set to. JARVIS uses this to figure out what "today" and
   "this week" mean, and to show event times with the right time zone.
5. Save `.env` and restart JARVIS (`npm start`).

### Step 3: One-time authorization

This is the one-time step where you grant JARVIS read-only access to your
calendar. Because JARVIS runs as a desktop app (not a website), this is done
via a couple of one-line commands you run once from a terminal:

1. With `.env` filled in from Step 2, make sure the project is built:
   ```bash
   npm run build
   ```
2. Print the authorization URL:
   ```bash
   node -e "console.log(require('./dist/skills/google-calendar/auth').getAuthorizationUrl())"
   ```
   This prints a `https://accounts.google.com/...` URL.
3. Open that URL in any browser (it doesn't have to be on the same machine -
   you can copy/paste it to your phone or another computer). Sign in with the
   Google account from Step 1 and click **Allow**. The consent screen will
   say JARVIS is requesting **read-only access to your calendars** - this
   matches the `calendar.readonly` scope and nothing more.
4. After clicking Allow, Google redirects your browser to
   `http://localhost:53682/oauth2callback?code=...&scope=...`. The page itself
   will likely show a "can't be reached" error in your browser - that's
   expected (nothing is listening on that port). What matters is the `code=`
   value in the URL's address bar. Copy everything between `code=` and the
   next `&`.
5. Run the following from this folder, replacing `PASTE_CODE_HERE` with the
   code you copied (you may need to URL-decode it - e.g. replace `%2F` with
   `/`):
   ```bash
   node -e "require('./dist/skills/google-calendar/auth').exchangeAuthorizationCode('PASTE_CODE_HERE').then(() => console.log('Connected!'))"
   ```
6. Restart JARVIS (`npm start`). Ask it "what's on my calendar today?" - it
   should now read your real calendar.

Your tokens are stored in JARVIS's local credential vault (Section 8 below),
never in `.env`, the repo, or anywhere else. To disconnect, remove the stored
tokens from the vault (e.g. delete the relevant entry from your OS keychain,
or `data/.jarvis-dev-vault.json` if you're using the file-based fallback) and
JARVIS goes back to stub mode for the calendar skill.

The same Google account/tokens also power the **Gmail** skill (read your
inbox, create drafts, and - as of this build - **send email**). Gmail uses
the same `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` from Step 2
above; no separate setup is required.

> **Gmail can now send email.** JARVIS can compose and send a real email, or
> send an existing draft, on your behalf. **Every send always asks for your
> explicit confirmation first** - it will show you the exact recipients,
> subject, and a preview of the body, and remind you that a sent email
> "cannot be unsent". There is no way for JARVIS to send mail without you
> clicking Confirm, even if Gmail isn't connected yet (it will simply show you
> what it *would* send). JARVIS has no tool to delete or trash email.

---

## 5. Connect Stripe (optional, TEST MODE)

JARVIS can look up your Stripe balance, recent charges, payouts, customers,
disputes, and invoices so it can answer questions like "what's my Stripe
balance?" or "any new disputes this week?". This part is **read-only**.

If you skip this section, JARVIS still works - the Stripe tools simply return
a clearly-labeled "no Stripe account is connected" placeholder with example
numbers.

### Stripe refunds & subscription cancellations (Tier 3)

JARVIS can also **refund a charge** (in full, or a partial amount you
specify) and **cancel a subscription**. These move real money and stop
recurring billing, so they are the most strictly-guarded actions JARVIS can
take:

- **Tier 3 - two-factor confirmation, always.** Before either action runs,
  JARVIS shows you a plain-language confirmation describing EXACTLY what's
  about to happen - the exact dollar amount and currency (e.g. "$25.50 USD"),
  whether it's a full or partial refund, the charge or subscription id, and a
  clear statement that this moves real money / stops billing and **cannot be
  undone**. You must click **Confirm** AND enter the 6-digit code from your
  authenticator app (e.g. Google Authenticator) - voice confirmation alone is
  never enough, and the code is never spoken aloud. If you haven't set up
  two-factor yet, JARVIS will tell you and refuse the action until you do.
- **Test-mode by default.** Like the read-only Stripe tools, refunds and
  cancellations only run against a `sk_test_`/`rk_test_` key unless you set
  `STRIPE_ALLOW_LIVE_MODE=true`. With no key configured (or in test mode
  without a real account), JARVIS shows a clearly-labeled stub result and
  makes no real Stripe call.
- **Still out of scope (FR-5.4):** JARVIS has NO tool to create new charges,
  change your payout/bank details, modify Stripe account settings, or manage
  API keys - by design, not just by omission.

**Safety rail: JARVIS defaults to Stripe TEST MODE.** It will refuse to use a
live-mode key (`sk_live_...`/`rk_live_...`) unless you explicitly set
`STRIPE_ALLOW_LIVE_MODE=true` in `.env` - so there's no risk of JARVIS
accidentally querying or refunding against your real, live Stripe account
while you're testing.

### Step 1: Create a restricted, read-only, TEST-MODE API key

1. Go to https://dashboard.stripe.com/ and sign in.
2. Make sure you're in **Test mode** (toggle in the top-right of the
   dashboard) - this is the default for a new Stripe account.
3. Go to **Developers -> API keys -> Create restricted key**.
4. Give it a name (e.g. "JARVIS").
5. Set the following to **Read** access, and leave everything else as **None**:
   - Balance
   - Payouts
   - Customers
   - Disputes
   - Invoices
6. If you want JARVIS to be able to issue **refunds** and **cancel
   subscriptions** (Tier 3, with two-factor confirmation), also set:
   - Charges: **Write**
   - Subscriptions: **Write**

   If you'd rather keep JARVIS read-only for now, leave these as **Read**
   (or **None**) - the refund/cancel tools will simply fail with a
   permission error from Stripe if called, and you can grant write access
   later by editing the key's permissions.
7. Click **Create key** and copy the key - it will start with `rk_test_`.

### Step 2: Add the key to JARVIS

1. Copy `.env.example` to `.env` if you haven't already (see Section 3).
2. Open `.env` and paste your key into either field (they're equivalent -
   use one):
   ```
   STRIPE_API_KEY=rk_test_your_key_here
   ```
3. Leave `STRIPE_ALLOW_LIVE_MODE` unset/`false` unless you specifically want
   JARVIS to use a live-mode key (not recommended).
4. Save `.env` and restart JARVIS (`npm start`). Ask it "what's my Stripe
   balance?" - it should now return real test-mode data from your account.
5. To use refunds/cancellations, also set up two-factor confirmation (see
   "Set up two-factor confirmation" below) - Tier 3 actions are refused until
   that one-time setup is done.

### Set up two-factor confirmation (required for refunds/cancellations)

Tier 3 actions (Stripe refunds, subscription cancellations) require a
6-digit code from an authenticator app (e.g. Google Authenticator, Authy, or
your password manager's TOTP support) in addition to clicking Confirm. This
is a one-time setup:

1. In the JARVIS UI, open **Settings -> Two-factor confirmation** and choose
   "Set up authenticator".
2. Scan the displayed QR code with your authenticator app, or type in the
   shown secret manually.
3. Enter the 6-digit code your app shows to confirm it's working.

After setup, any Tier 3 action will prompt for both a Confirm/Cancel decision
and this 6-digit code. The code is entered in the UI only - JARVIS never asks
you to say it out loud, since a recording could capture a spoken code.
Running setup again generates a new secret and invalidates the old one.

---

## 6. JARVIS and your files

JARVIS can read, write, organize, and "delete" files within **one folder on
your computer** - by default `~/Claude 2nd brain/JARVIS/` (under your home
directory). It can never see or touch anything outside that folder.

- **Auto-created.** If the folder doesn't exist yet, JARVIS creates it
  automatically the first time it starts - you don't need to create it
  yourself.
- **What JARVIS can do in this folder:**
  - List what's there, read text files, and check file/folder info (no
    confirmation needed - read-only).
  - Create new files and folders, and write to files that don't exist yet
    (no confirmation needed - easy to undo).
  - **Overwrite** an existing file, or move/rename something onto an
    existing path (confirmation required, since the old contents would be
    replaced).
  - "Delete" a file or folder (confirmation required) - see below.
- **Deletes go to `.jarvis-trash/`, not oblivion.** When JARVIS "deletes" a
  file or folder, it actually MOVES it into a `.jarvis-trash/` folder inside
  your JARVIS folder, with the date/time added to its name (e.g.
  `20260613T083000-old-notes.txt`). Nothing is permanently erased - if JARVIS
  (or you) deletes something by mistake, you can find it in `.jarvis-trash/`
  and move it back. JARVIS does not automatically empty this trash folder.
- **Large files.** JARVIS won't read text files larger than about 1MB (it
  will tell you clearly rather than flooding the conversation).

### Changing the folder

Set `JARVIS_ALLOWED_DIR` in `.env` to the full path of a different folder, and
restart JARVIS. For example:

```
JARVIS_ALLOWED_DIR=/Users/yourname/Documents/JARVIS
```

---

## 7. Cost meter & budget cap

Every call JARVIS makes to the Claude API is recorded in a local cost ledger
with an **estimated** cost in USD, based on the model's published per-million-
token pricing for input/output tokens (Sonnet 4.5: $3 / $15 per million
input/output tokens; Haiku 4.5: $1 / $5 per million - see
https://www.anthropic.com/pricing and `core/brain.ts` for the exact table;
this is an estimate, not your actual bill from Anthropic).

The sidebar's **Status** panel shows:
- **Cost today** and **Cost this month** - running totals from the ledger.
- **Budget cap** - your configured `JARVIS_MONTHLY_BUDGET_USD` (default `$20`).

Set `JARVIS_MONTHLY_BUDGET_USD` in `.env` to your preferred monthly limit.

- At **80%** of the cap, the sidebar shows a yellow "approaching budget cap"
  warning.
- At **100% or more**, the sidebar shows a red warning and JARVIS switches to
  **restricted mode**: it stops making further paid Claude calls for the rest
  of the calendar month and instead replies with a clearly-labeled message
  explaining that the cap has been reached. Read-only tools, the activity
  log, and the cost ledger remain available. JARVIS automatically resumes
  normal operation at the start of the next month, or as soon as you raise
  `JARVIS_MONTHLY_BUDGET_USD`.

---

## 8. The credential vault

JARVIS stores integration secrets (API keys, OAuth tokens - used by later
phases) in your operating system's secure keychain:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service (e.g. GNOME Keyring)

If that's unavailable (common on headless Linux/CI, or if the optional
`keytar` package didn't install), JARVIS automatically falls back to an
**encrypted local file** under `data/.jarvis-dev-vault.json`. This fallback is
for development/testing only and is clearly marked as such in
`security/vault.ts`. You don't need to do anything - JARVIS picks the right
backend automatically and the rest of the app behaves identically either way.

---

## 9. Useful commands

| Command | What it does |
|---|---|
| `npm start` | Build the project and launch the desktop app |
| `npm run dev` | Same as `npm start`, with extra Electron logging |
| `npm run build` | Compile TypeScript to `dist/` without launching the app |
| `npm test` | Run the automated test suite (no GUI required) |
| `npm run typecheck` | Check for TypeScript errors without building |
| `npm run lint` | Run the linter |

---

## 10. What's in this Phase 1 build

- **`app/`** - Electron main process + preload bridge (window, IPC). Connects
  all skills and surfaces the live cost meter / budget status at startup.
- **`ui/`** - The desktop window's HTML/CSS/TypeScript (conversation view,
  activity log, status panel, cost meter + budget warnings, confirmation
  modal).
- **`core/`** - The "Brain": talks to the Claude API (or returns a stub reply
  if no key is set), runs the generic MCP tool-use loop (FR-2.3) so the model
  can call any connected skill's tools, the permission-tier framework
  (Tier 0-3) that enforces R-6 (every tool call is classified and, for Tier
  2/3, refused before confirmation), and the monthly budget cap / restricted
  mode (FR-8.3).
- **`skills/`** - MCP client plumbing and the skill registry. Built-in
  integrations: `skills/google-calendar/` (read + write events),
  `skills/gmail/` (read, draft, and send - send is Tier 2 with mandatory
  confirmation), and `skills/stripe/` (read-only, TEST MODE by default).
- **`voice/`** - Pluggable voice adapter interface. Currently ships the
  text-only fallback (FR-1.6) - full voice arrives in a later phase.
- **`store/`** - SQLite access for conversations, the activity log, long-term
  memory, the cost ledger (with budget-cap status), and settings.
- **`security/`** - The credential vault wrapper described above, storing
  Google OAuth tokens and (optionally) a Stripe API key.
- **`config/`** - Reads `.env` and exposes typed configuration to the rest of
  the app, including the time zone, Google OAuth, Stripe, and budget settings.
- **`test/`** - Automated tests covering config, permission tiers (including
  Tier 2/3 refusal and confirmation flows), the store, the vault, the
  tool-use loop, the agent's stub-mode flow, the Google Calendar/Gmail/Stripe
  skills' stub modes, Gmail send confirmation, and the budget cap.

---

## 11. Troubleshooting

- **Nothing happens / window doesn't open**: make sure you're running on a
  machine with a desktop environment (Electron needs a display). Headless
  servers can still run `npm test` and `npm run build` to verify everything
  compiles.
- **"Stub mode" never goes away after adding a key**: double-check the file is
  named exactly `.env` (not `.env.example` or `.env.txt`) and is in the same
  folder as `package.json`, then restart with `npm start`.
- **Calendar tools always say "no calendar connected yet"**: make sure
  `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set in `.env`
  (Section 4, Step 2) and that you've completed Step 3 (one-time
  authorization). If you've done both and it's still in stub mode, your stored
  token may have been revoked - re-run Step 3 to re-authorize.
- **"invalid_grant" or "redirect_uri_mismatch" during authorization**: the
  authorization code from Step 3 can only be used once and expires quickly -
  request a fresh URL (Step 3.2) and complete the exchange (Step 3.5) right
  away. A `redirect_uri_mismatch` means the OAuth client in Google Cloud
  Console isn't a "Desktop app" type, or `GOOGLE_OAUTH_REDIRECT_URI` in `.env`
  doesn't match what's registered - Desktop app clients accept the default
  loopback redirect automatically, so leaving it blank is usually correct.
- **Want a clean slate?** Delete the `data/` folder (and `.env` if you want to
  remove your key) and run `npm start` again - everything is recreated.

# JARVIS (Phase 0: Foundation Scaffold)

JARVIS is a voice-first personal AI agent that runs on your own computer. This
repository is the **Phase 0** build: a runnable desktop app with a chat
window, an activity log, and all the local plumbing (database, credential
vault, permission framework) that later phases build on. **No accounts or API
keys are required to run it.**

See `PRD-JARVIS.md` for the full product plan. This README only covers
getting Phase 0 running.

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

## 4. The credential vault

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

## 5. Useful commands

| Command | What it does |
|---|---|
| `npm start` | Build the project and launch the desktop app |
| `npm run dev` | Same as `npm start`, with extra Electron logging |
| `npm run build` | Compile TypeScript to `dist/` without launching the app |
| `npm test` | Run the automated test suite (no GUI required) |
| `npm run typecheck` | Check for TypeScript errors without building |
| `npm run lint` | Run the linter |

---

## 6. What's in this Phase 0 build

- **`app/`** - Electron main process + preload bridge (window, IPC).
- **`ui/`** - The desktop window's HTML/CSS/TypeScript (conversation view,
  activity log, status panel).
- **`core/`** - The "Brain": talks to the Claude API (or returns a stub reply
  if no key is set) and the permission-tier framework (Tier 0-3).
- **`skills/`** - MCP client plumbing and the skill registry. Empty in Phase
  0 - no real integrations (Calendar/Email/Stripe/Filesystem) yet.
- **`voice/`** - Pluggable voice adapter interface. Phase 0 ships only the
  text-only fallback (FR-1.6) - full voice arrives in a later phase.
- **`store/`** - SQLite access for conversations, the activity log, long-term
  memory, the cost ledger, and settings.
- **`security/`** - The credential vault wrapper described above.
- **`config/`** - Reads `.env` and exposes typed configuration to the rest of
  the app.
- **`test/`** - Automated tests covering config, permission tiers, the store,
  the vault, and the agent's stub-mode flow.

---

## 7. Troubleshooting

- **Nothing happens / window doesn't open**: make sure you're running on a
  machine with a desktop environment (Electron needs a display). Headless
  servers can still run `npm test` and `npm run build` to verify everything
  compiles.
- **"Stub mode" never goes away after adding a key**: double-check the file is
  named exactly `.env` (not `.env.example` or `.env.txt`) and is in the same
  folder as `package.json`, then restart with `npm start`.
- **Want a clean slate?** Delete the `data/` folder (and `.env` if you want to
  remove your key) and run `npm start` again - everything is recreated.

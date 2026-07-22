# Beat Drew

A single-user, **local-first, installable PWA** that gamifies *real-world
improvement* across three domains — **Health, Wealth, Relationships** — framed
as a daily confrontation with **Drew**: the disciplined version of Andrew who
does all seven non-negotiables every day and is always five pounds ahead.

- **Local-first & private.** All data lives in your browser's IndexedDB (via
  Dexie). No accounts, no backend, no analytics, no network calls beyond loading
  the static app shell. Works fully offline (airplane mode) after the first load.
- **Rewards the real action, never the app-open.** XP, animations, sound, and
  haptics fire only when you log a genuinely completed action — never on launch,
  a check-in, or a notification tap.
- **No punitive resets.** Missing a day never wipes a streak or strips progress.
  Mastery never decays. A missed day spends a *freeze token* instead of resetting.

## Screens

| Screen | What it does |
| --- | --- |
| **Today** | Drew's law, closable rings for the 7 non-negotiables, day status (WON / NOT YET / LOST TO DREW), streak + freeze tokens, XP today, Drew's contextual voice line, one optional evening reminder. |
| **Log** | Fast metric entry + a workout logger with automatic PR detection and the "Drew +5 lb" acknowledgment. Every entry fires the reward mechanics. |
| **Progress** | Non-decaying, uncapped **Mastery Tracks**; metric trend charts; the **Master Number** gauge (consecutive months ≥ $6K); PR history. |
| **The Villain** | Drew's standard vs your current for every sub-area, % of the gap closed from real data, Never-Again clean-streak counters, and the 10 Drew voice lines. |
| **Reckoning** | Daily confrontation, weekly score, guided monthly review, yearly reckoning, and an optional "share my week" export. |
| **Settings** | Edit targets/baselines/rest day/schedule anchors, reward-fading phase, sound/haptic/reminder toggles, and **JSON backup / restore**. |

## Run & build

```bash
npm install
npm run dev       # local dev server (http://localhost:5173)
npm run build     # type-check + production build → dist/ (installable PWA)
npm run preview   # serve the production build locally
npm run test      # unit tests (scoring, freezes, PR detection, round-trip)
```

The PWA icons are generated with zero native dependencies:

```bash
npm run gen:icons   # regenerates public/icons/* and apple-touch-icon.png
```

## Deploy to a static host

HTTPS is required for install prompts and service workers. Data stays on the
device regardless of where the shell is hosted.

- **Netlify** — `netlify.toml` is included. Connect the repo (build `npm run
  build`, publish `dist`) or drag-and-drop the `dist/` folder.
- **Vercel** — `vercel.json` is included. Import the repo; framework preset
  "Vite" is auto-detected.
- **GitHub Pages** — `.github/workflows/deploy.yml` builds and deploys on push
  to `main`. In the repo, set **Settings → Pages → Source: GitHub Actions**. The
  Vite `base` is `'./'`, so the app also works from a project sub-path.

## Install on your phone

- **Android (Chrome):** open the site → menu (⋮) → **Add to Home screen** /
  **Install app**. It launches standalone and works offline.
- **iPhone (Safari):** iOS does **not** show an install prompt. Open the site in
  Safari → tap **Share** → **Add to Home Screen**. Launch it from the home-screen
  icon for the full-screen, offline experience.

## Back up your data (important)

Because everything is local, **your data lives only on this device.** Clearing
site data or losing the device loses your history unless you have a backup.

- **Settings → Backup & restore → Export JSON** saves a full snapshot file.
- **Import JSON** wipes the current data and restores from a snapshot (round-trips
  exactly). Use it to move between devices or recover.
- The app shows a gentle weekly backup reminder.

## How the psychology is wired (auditable)

The evidence-backed mechanics live in `src/lib/rewards.ts` and are commented so
the design is auditable:

- **Mastery Tracks** (`src/lib/mastery.ts`) — permanent, non-decaying, uncapped
  XP per domain area. Never stripped.
- **Endowed starter-progress** — every track seeds pre-filled, never at zero
  (`src/db/seed.ts`).
- **Reward-prediction-error / surprise bonuses** — ~15–20% of qualifying logs
  fire a *variable* bonus, sometimes with a rare Drew tip. Fixed payouts go flat,
  so the payout varies (`rollReward`).
- **Continuous → variable arc** — a track rewards every action for its first ~21
  days (Bootstrap), then thins the base reward and leans on surprises
  (`autoPhaseFor`).
- **Reward scaled to real impact** — a workout or a sales hour is worth more base
  XP than a minor check (`ACTION_WEIGHTS`).
- **Gentle loss aversion** — earn a freeze token per fully-won week (bank up to
  2); a missed day spends a freeze instead of resetting (`src/lib/streak.ts`).
- **Reward-fading (Bootstrap → Sustain → Fade)** — a first-class, user-visible
  Settings control; extrinsic points taper so behavior transfers to intrinsic
  motivation.

**Guardrail:** every reward call site passes through `assertReal(...)`, which
throws if a reward is fired without a real logged action. Search the codebase for
`assertReal(` to confirm no reward is wired to an app-open. Dark patterns
(punitive resets, app-open rewards, manufactured near-miss traps, leaderboards,
guilt notifications) are deliberately **not** built.

## Tech

React + Vite + TypeScript · Zustand (state) · Dexie / IndexedDB (persistence) ·
Recharts (charts, lazy-loaded) · `vite-plugin-pwa` / Workbox (offline shell).
No backend, no auth, no telemetry, no external fonts or CDNs.

## Seeded first-run state

On first run the app seeds exactly the numbers from Andrew's Villain Dossier
(baselines, targets, tracked lifts, never-again counters, the ledger, and the 10
Drew voice lines) from `src/db/seed.ts`. Everything is editable later in Settings.
Nothing is fabricated — anything the dossier is silent on is a blank, editable
field.

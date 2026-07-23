# Lift Log

A single-user, **local-first, installable PWA** gym session tracker. Log your
workout, time the session, track sets × reps, calculate plate loads, and watch
your **real strength progress** level up like an RPG stat sheet — no avatar, no
persona, no rival, just your own numbers climbing.

Everything lives on your device (IndexedDB). **No account, no server, no
analytics, no tracking.** It works fully offline after the first load.

## What it does

- **Log the workout** — add exercises from a seeded catalog (or your own) to a session.
- **Time the session** — a live timer computed from stored timestamps, so it stays
  correct across reload and backgrounding.
- **Track sets & reps** — log each set as weight × reps, one-handed, fast.
- **Plate calculator** — tap how many of each plate you loaded *per side*; it shows
  the total on the bar and drops straight into the set you're logging.
- **Progression** — non-decaying mastery tracks, an overall Lifter Level, PR
  detection (heaviest, best estimated 1RM, rep PRs), consistency streaks with
  freezes, and a reward system that **fades** as habits form.

### Six screens
Home / Dashboard · Active Session · History / Log · Plate Calculator · Progress /
Levels · Settings.

## Design guardrails (deliberate, not incidental)

- **Rewards fire ONLY on real logged actions** — a logged set, an ended session, or
  a real PR. Never on app-open, screen navigation, or a notification tap. This is
  enforced at the type level (`RewardTrigger` has no app-open member) and asserted
  at every call site (`assertRealAction`).
- **Mastery / levels / XP never decay.** Missing days never strips progress.
- **No punitive streak resets.** A missed day spends a banked *freeze* token; only
  the streak *counter* ever restarts, and never your XP, levels, or PRs.
- **No fabricated data.** Only the exercise catalog and track definitions are
  seeded. Your PRs, weights, and targets start empty and come from real logs.
- **Tunable, neutral defaults.** The XP formula constants (`BASE_SET_XP`,
  `VOLUME_DIVISOR`, PR bonus, surprise probability) are editable in Settings.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL (default http://localhost:5173).

## Test & typecheck

```bash
npm test        # vitest run — plate math, Epley 1RM, XP, PR detection, streak/freeze, reward integrity
npm run typecheck
```

## Build

```bash
npm run build   # typechecks, then produces an installable PWA in dist/
npm run preview # serve the production build locally
```

The build emits the app shell plus `manifest.webmanifest`, a Workbox service
worker (`sw.js`), and maskable icons at 192 & 512 — everything needed to install
and run offline.

## Deploy to a static host

The app is a static bundle in `dist/`. HTTPS is required for install and service
workers.

- **Netlify:** `npm run build`, then drag `dist/` into Netlify, or connect the repo
  with build command `npm run build` and publish directory `dist`.
- **Vercel:** import the repo; framework preset **Vite**; output directory `dist`.
- **GitHub Pages:** `npm run build` and publish `dist/` (e.g. via the `gh-pages`
  branch or an Actions workflow). If hosting under a sub-path, set Vite's `base`
  accordingly.

## Install on your phone

- **iPhone (iOS/Safari):** open the site in Safari → tap the **Share** button →
  **Add to Home Screen**. iOS does not show an automatic install prompt (there's an
  on-screen note in Settings reminding you).
- **Android (Chrome):** tap the **Install app** prompt, or the browser menu →
  **Add to Home screen / Install app**.

After installing, launch it once online to cache the shell; from then on it works
in airplane mode.

## Back up your data

Because everything is local, **you are the backup**. In **Settings → Backup**:

- **Export all data (JSON)** downloads your entire database (sessions, sets, PRs,
  tracks, levels, settings).
- **Import backup** restores from that file — an export → clear → import round-trip
  is lossless.

Export periodically (Settings shows the last backup date and can nudge you weekly).
Uninstalling the app or clearing browser storage erases local data, so keep a
recent JSON export.

## Tech

React + Vite + TypeScript · Zustand (state) · Dexie / IndexedDB (persistence) ·
vite-plugin-pwa / Workbox (offline) · hand-rolled SVG charts (no chart library).
Dependencies are kept intentionally minimal.

## Data model (Dexie tables)

`sessions`, `exercises`, `sessionExercises`, `sets`, `prs`, `tracks`,
`consistency` (singleton), `rewardsLog`, `settings` (singleton). Only the exercise
catalog and track definitions are seeded on first run.

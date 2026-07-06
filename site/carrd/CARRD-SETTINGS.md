# Carrd setup checklist — coldflowforge.com

The two embed files in this folder cover everything that lives *inside* the page.
This checklist covers the settings only the Carrd editor can control.

## 1. Paste the embeds

- **Main page:** replace your current embed's code with `main-embed.html` (the whole file).
- **Privacy page:** in Carrd, add a new **section** and name it exactly `privacy`
  (the main page's footer links to `#privacy`). Inside it, add an Embed element and
  paste `privacy-embed.html`. The "Back to site" link points to `#` (the default/top
  section on any Carrd setup) — change it to `#` + section name to target a specific one.

## 2. Site settings (Main menu → Settings)

| Setting | Recommended value |
|---|---|
| Title | `Cold Flow Forge — Controlled Outbound for B2B Agencies` |
| Description (meta) | `15–20 qualified sales calls in 90 days for B2B agencies — controlled cold outbound with no big upfront retainer, and your domain never at risk.` |
| Share image (OG) | Upload a 1200×630 image — dark background `#101216`, the ember diamond mark + "COLD FLOW FORGE". This is what shows when the link is shared on LinkedIn — worth doing properly. |
| Favicon | The ember diamond mark on `#101216`. |
| Background | Set the page background color to `#101216` so it matches the embed even before scripts run. |
| Language | `en` |

## 3. After publishing, test these

- [ ] Load the site with JavaScript disabled (or with an ad blocker in aggressive mode) — all content should still be visible (the reveal animation is now JS-gated instead of hiding content by default).
- [ ] On Windows (visible scrollbars): no horizontal scrollbar / side-to-side jiggle.
- [ ] Click a CTA button within the first second of page load — it should either open the Calendly popup or fall back to navigating to the Calendly page. No console errors.
- [ ] Click the video — the YouTube player should load and autoplay on click (it no longer loads ~1MB of player code up front).
- [ ] Footer: email link opens mail client; Privacy link jumps to the privacy section; "Back to site" returns.
- [ ] On a phone: scroll down — the sticky "Book my free audit" bar should slide up after the hero button passes, and slide away while the booking section is on screen.
- [ ] Book a test call through the inline widget on a phone.
- [ ] Paste the URL into LinkedIn's post composer — check the preview shows your title, description, and share image.

## 4. Editable values in the code (search for "EDIT-")

Every value you're likely to change has a searchable marker comment in `main-embed.html`:

| Marker | What it controls | Status |
|---|---|---|
| `EDIT-1` | The guarantee wording in the ember box. Currently a common performance-agency guarantee ("we keep working for free until we do") written to match the claims already on your page. **Confirm you'll honor it or rewrite it before publishing.** | Needs your terms |
| `EDIT-2` | The three audit deliverables ("what you walk away with"). | Draft, edit freely |
| `EDIT-3` | Sticky mobile CTA button text. | Draft |
| `EDIT-5a/b/c` | Specificity slots in the process steps — comments show example rewrites; drop in your real numbers (list sizes, domain/inbox counts, warmup days, review cadence) when you can state them truthfully. | Waiting on your numbers |
| `EDIT-6` | The FAQ pricing answer. Like the guarantee, this is a commitment — make sure it matches how you actually charge. | Needs your confirmation |
| Calendly URL | In 5 CTA links + the booking widget (11 occurrences) — find & replace `calendly.com/andrew-coldflowforge/30min`. | Set |

## 5. EDIT-4 — Calendly qualification questions (2-minute task)

The Calendly API doesn't allow editing booking-form questions, so add these by hand:
**Calendly → Event types → Cold Flow Pipeline Audit → Booking page options → Invitee questions.**

1. **"Roughly, what's your agency's current monthly revenue?"** — multiple choice, required:
   `Under $10k` / `$10k–$25k` / `$25k–$50k` / `$50k–$100k` / `$100k+`
2. **"Which best describes your core offer?"** — multiple choice, required:
   `Proven — happy clients and results behind it` / `Newer — still validating`
3. **"Where do most new clients come from today?"** — multiple choice, required:
   `Referrals & word of mouth` / `Inbound (content, SEO)` / `Outbound` / `Paid ads` / `Honestly, it's unpredictable`
4. Keep the existing optional "Please share anything that will help prepare for our meeting." as the last question.

Already done via the API: the event's **description** now sells the audit as a working
session with three concrete deliverables (it was empty). Edit it anytime in Calendly.

## 6. Open TODOs in the code

- `main-embed.html` — the stat tiles cite SparkToro but aren't linked yet. When you
  have the exact report URL, follow the `TODO` comment above the `.statbar` block.
- FAQ answers (especially the pricing one) are **drafts written to match the claims
  already on the page** — read them and adjust anything that doesn't match how you
  actually operate before publishing.
- `privacy-embed.html` is a plain-language template — have a lawyer glance over it.

# Your next 5 steps — coldflowforge.com

Everything below is in order. Do them top to bottom; each step says exactly where to
go, what to do, and how you know it's done. Files live in `site/carrd/` in your repo.

---

## Step 1 — Lock in the words that are promises (~30 min, before anything goes live)

Two pieces of copy on this page are **commitments**, not marketing. They're written
as strong defaults, but you must confirm or rewrite them — publishing a promise you
won't honor is worse than no promise.

1. Open `main-embed.html` and search for **`EDIT-1`** — the guarantee box.
   Current wording: *"If we don't deliver the qualified calls we agree to in writing,
   we keep working for free until we do."* Decide your real terms (work-for-free?
   partial refund? extended term?) and make the text match. Keep it one sentence,
   specific, no asterisks.
2. Search for **`EDIT-6`** — the FAQ pricing answer. It currently says compensation
   is tied to calls that book and hold, not a flat fee. Confirm that's actually your
   pricing model, or rewrite it to match.
3. While you're in there, skim the other five FAQ answers (search `<details>`).
   They were drafted to match claims already on your page — change anything that
   isn't literally true of how you operate.

**Done when:** you'd be comfortable having a client read the guarantee and the
pricing answer back to you in a contract dispute.

---

## Step 2 — Load the code into Carrd (~30 min)

1. Log in to Carrd → your site → the Build view.
2. **Main page:** open your existing Embed element (the one holding the current
   site code), delete its contents, and paste in the entire `main-embed.html` file.
   Embed settings: Type **Code**, Style **Hidden** (head + body allowed).
3. **Privacy page:** add a new **section** and name it exactly `privacy`
   (the footer's Privacy link points to `#privacy`). Add an Embed element inside it
   and paste in the entire `privacy-embed.html` file.
4. Open Carrd's **Settings** and apply the table in `CARRD-SETTINGS.md` §2:
   - Title: `Cold Flow Forge — Controlled Outbound for B2B Agencies`
   - Meta description (copy from the checklist)
   - Page background color: `#101216`
   - Favicon + **share image** (1200×630, dark, diamond mark + wordmark — this is
     what LinkedIn shows when your link is shared; make it in Canva in 10 minutes).

**Done when:** Carrd's preview shows the new page and the privacy section exists.

---

## Step 3 — Add the qualification questions in Calendly (~5 min)

The event description is already updated (done via API — check it and edit freely).
The questions can't be set by API, so add them by hand:

**Calendly → Event Types → Cold Flow Pipeline Audit → Booking page options →
Invitee questions**, add in this order, all multiple-choice, all required:

1. *"Roughly, what's your agency's current monthly revenue?"*
   `Under $10k` / `$10k–$25k` / `$25k–$50k` / `$50k–$100k` / `$100k+`
2. *"Which best describes your core offer?"*
   `Proven — happy clients and results behind it` / `Newer — still validating`
3. *"Where do most new clients come from today?"*
   `Referrals & word of mouth` / `Inbound (content, SEO)` / `Outbound` / `Paid ads` / `Honestly, it's unpredictable`

Keep the existing optional "share anything…" question last.

**Done when:** you book a test slot yourself and see all four questions.

---

## Step 4 — Publish and run the test checklist (~20 min)

Publish in Carrd, then walk `CARRD-SETTINGS.md` §3 on the live site. The short
version:

- [ ] Desktop: page loads, all sections visible, no sideways scroll (check on
      Windows if you can — that's where scrollbar bugs show).
- [ ] Click a CTA within the first second after load — popup or clean fallback,
      no errors.
- [ ] Video: click to play — the player should load only on click.
- [ ] Phone: sticky "Book my free audit" bar appears after the hero, disappears
      over the booking widget.
- [ ] Footer: email opens mail app; Privacy jumps to the policy; "Back to site" returns.
- [ ] Book (and cancel) a real test call end-to-end.
- [ ] Paste `coldflowforge.com` into a LinkedIn draft post — title, description,
      and share image should all appear.

**Done when:** every box is checked on the live domain, not the Carrd preview.

---

## Step 5 — The credibility loop (ongoing, first 90 days)

These are the things that will move the site from "clean" to "convincing," in order
of impact:

1. **Real numbers into the EDIT-5 slots.** Once your process is fixed (how many
   sending domains, how many inboxes, warmup days, review cadence), search
   `main-embed.html` for `EDIT-5` and replace the generic lines — each comment has
   an example rewrite. Specific beats vague on every landing page ever tested.
2. **Link the stats.** Find the SparkToro report the 14% / ~70% stats came from and
   follow the `TODO` above the statbar to make the tiles clickable. Unlinked
   sources read as decoration; linked ones read as receipts.
3. **Collect proof from your first 3–5 clients.** A one-line quote with a name and
   agency beats any amount of copy. When you have 2–3, we add a proof section —
   and revisit the founder section (you're already the face in the VSL; the page
   should say who you are).
4. **Lawyer glance at the privacy policy** (`privacy-embed.html`). It's a solid
   plain-language template, but outbound email is a compliance-sensitive business —
   15 minutes of a lawyer's time is cheap insurance.
5. **Watch what real prospects do.** Carrd Pro supports analytics embeds if you
   want them later (note: adding one means updating the privacy policy's "no
   analytics" line). Until then, the Calendly answers from Step 3 are your data —
   they tell you who's actually landing on the page.

---

*Everything in the code is marked: search `EDIT-` in `main-embed.html` for every
value meant to change. Full editable-values table: `CARRD-SETTINGS.md` §4.*

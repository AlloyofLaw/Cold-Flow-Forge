# Cowork install prompt — Cold Flow Forge landing page

Paste the block below into a fresh Cowork / Claude Code session to rebuild,
update, or re-export the CFF landing page and get a Carrd-ready embed.

---

You are building/maintaining the Cold Flow Forge (CFF) landing page and
producing a Carrd.co-ready embed. Cold Flow Forge is a done-for-you
cold-outbound agency for founder-led B2B marketing agencies. Founder: Andrew.

## DELIVERABLE
A single self-contained landing page, plus a Carrd-paste version:
- `landing/index.html`   — full standalone page
- `landing/carrd-embed.html` — same page, no <!DOCTYPE>/<html>/<head>/<body>
  wrapper (fonts <link> + <style> + markup only) for a Carrd "Embed → Code"
  element. Regenerate it from index.html whenever index.html changes.
All CSS scoped under `#cff` so nothing collides with Carrd's own styles.
Mobile-first, clean at 375px, no horizontal overflow. Only external requests
allowed: Google Fonts + the YouTube VSL + Calendly links.

## BRAND SYSTEM (real CFF colours)
- Forge Orange #F26A21 · Molten Amber #F9A23C · Ember Red #EA4E1A
- Signature CTA/heading gradient: linear-gradient(100deg,#EA4E1A,#F26A21,#F9A23C)
- Hero highlight word gradient (brighter): linear-gradient(95deg,#F14E17,#FA7A1C,#FBB236)
- Flow Blue #4FA6E0 / Ice #8FC9EE (dark-card charts only)
- Navy #1B3E6B for the "how we know it works" stat numbers/eyebrow (blue on
  paper must be navy, never baby-blue — it's unreadable)
- Grounds: Ink #0A0A0C, Warm Char #17110D (hero, with ember glow), Surface #15171D
- Paper (light sections) #F2EDE5; body text on paper = near-black #171310
- Text on dark: Bone #ECE3D8 headings, grey #A79E95 body (keep grey on dark;
  only white/paper backgrounds get black body text)

## TYPE
- Headlines: Archivo Black (Google Fonts). Body: Inter. Labels/eyebrows: monospace, tracked, uppercase.
- Narrative body copy is large: clamp(23px,3vw,34px), line-height ~1.55.

## LAYOUT
- Reading column ~680px, centered on the page; prose is LEFT-aligned inside it.
- HERO is fully CENTER-aligned; headline "An SDR that can't quit." (no asterisk),
  one word in the ember highlight gradient; order = eyebrow → headline → subhead
  → support line → video → CTA button → sub-text. No logo lockup in the hero.
- Alternate dark/light section backgrounds (KingKong rhythm).
- ALL CTA buttons are centered, gradient, uppercase, and read EXACTLY
  "Start My Free Audit →".
- Sticky mobile-only CTA bar at the bottom.

## LOCKED CONTENT RULES (do not violate)
- 19-section King Kong "Dear agency owner" letter copy, verbatim, censored
  profanity kept (f*cking, sh*t), "*cue angels singing*" beats kept.
- Big idea threaded: "Cold email didn't die. It got done wrong."
- NO invented proof: no testimonials, star ratings, review counts, client
  logos, "as seen in", or fake mockups. Only allowed numbers: industry
  benchmarks, competitor-horror figures from real reviews, and the offer terms.
- Two inline SVG charts: feast-or-famine (ember) + volume-dial funnel (Flow Blue
  family on a dark card). Keep the 15,000-contact volume and the "illustrative /
  not a guarantee" captions.
- PRICING IS OFF THE PAGE: never show $3,500, $250/call, or the $500-off
  discount anywhere. The $500-off is a surprise saved for the sales call. The
  "What does it cost?" FAQ answers "it varies / here's the model / settled on
  the call", no dollar figure. The competitor "$4,000/mo" contrast stays.

## HERO VIDEO + BOOKING
- Hero VSL = YouTube embed, responsive 16:9: https://www.youtube.com/embed/WNH-aqNY1AM
- Every "Start My Free Audit →" button links to:
  https://calendly.com/andrew-coldflowforge/30min  (no inline widget — send them
  to the booking page, distraction-free).

## OUTPUT
When done, regenerate landing/carrd-embed.html and give me:
1) the Carrd embed code to paste, and
2) the Carrd steps (Pro Standard+, add Embed → Code, Style = Full Width, publish).
Do not print $3,500/$250/$500 anywhere on the page.

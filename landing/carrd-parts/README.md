# Carrd embed — split into parts (Carrd 16,000-char code limit)

The landing page exceeds Carrd's per-Code-element character limit, so it's
split into 5 files. In your Carrd page, add **5 separate Embed → Code
elements, stacked in this exact top-to-bottom order**, and paste one file
into each:

1. part-1.html  — fonts + styles (1 of 2)
2. part-2.html  — styles (2 of 2)
3. part-3.html  — page markup (nav → "power is in the system")
4. part-4.html  — page markup (pillars → "straight talk")
5. part-5.html  — page markup (audit → FAQ + sticky bar)

Notes:
- Order matters: the two style parts must come before the markup parts.
- Set every embed's Style to **Full Width**; set element spacing to 0 so the
  sections meet seamlessly.
- Styles are scoped under `.cff`; each markup part is wrapped in its own
  `<div class="cff">`, so the shared styles apply across all parts.
- Start from a blank Carrd site so nothing else adds padding.

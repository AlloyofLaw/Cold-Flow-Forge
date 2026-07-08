# Monthly Money dashboard spec

One self-contained HTML page (strict CSP: all CSS/JS inline, no external requests), rendered from the `metrics` JSON only. Load the **dataviz skill before writing any chart code** — it owns color, form, and accessibility rules; this spec owns content and order. Style both light and dark themes. Title: `Monthly Money`. Mobile-first: Andrew will often open this on his phone.

All amounts CAD, formatted `$1,234`. Negative/over-budget in the dataviz "bad" color, positive/under in "good".

## Section order (top to bottom)

1. **Header** — "Monthly Money — {Month Year}", months-in-ledger count, and a "Rogers card not included" warning banner when applicable.

2. **Headline stat row** (4 tiles):
   - **Freed for business** — the hero number (`freed_for_business.current`), with delta vs last month when available
   - Income
   - Personal spending
   - Net cash flow
   Baseline month: replace deltas with "first month — baseline".

3. **Freed-for-business trend** — line/bar over `freed_for_business.history`. Skip when only one month exists.

4. **Where the money went** — horizontal bar per category (`categories`), sorted by total, essential vs discretionary distinguished. Each bar: total, MoM delta arrow, vs-3-month-average marker when present.

5. **Biggest movers** — top 3 categories by `|mom_delta|` (or `vs_avg`), one line each in plain words: "Dining & Takeout up $142 vs last month". Skip on baseline month.

6. **Budget vs actual** — when `budget_vs_actual` exists: per-category progress bars, over-budget flagged. When `budget_proposal` exists instead: render the proposal as a table and note that it's pending approval in chat.

7. **Subscriptions & recurring** — table from `recurring`: merchant, monthly cost, months seen, price-creep badge when set. Footer: total recurring per month — "these renew whether you think about them or not."

8. **Top merchants & big-ticket** — two columns (stack on mobile): top-10 merchants bar list; big-ticket table (date, merchant, amount, category).

9. **Business spending** — `business.total` and by-merchant list. If zero, one quiet line: "No business spending this month."

10. **Footnotes** — `uncategorized_count` if nonzero, `usd_transactions` if any, data sources included this run, generation date.

## Tone

Labels and callouts are written to the reader ("You spent…", "Up $80 from your average"), not database-speak. The dashboard's job is a decision in under a minute: *what do I cut, what do I feed the business*.

# Workflow: Monthly Money Review

## Objective

Once a month, turn Andrew's raw bank data into one dashboard that answers: where did the money go, what changed, and how much could be redirected to the business. The end state of every run: ledger updated, dashboard published at the evergreen link, snapshot archived, everything committed.

## Required inputs

1. **RBC CSV export(s)** — chequing and credit card, covering the month under review. If the user hasn't provided them, walk them through `workflows/references/rbc-export-guide.md` and wait.
2. **Rogers card screenshot(s)** — the card is shared with his mum; he screenshots *only his section* of the statement. Whatever appears in the screenshot is his by definition — never ask whose transaction it is.

Save everything the user provides to `.tmp/monthly-money/YYYY-MM/`. Raw exports contain account numbers and are never committed — `.tmp/` is gitignored for exactly this reason.

## Tools used

- `tools/parse_rbc.py` — RBC CSV → normalized transaction JSON
- `tools/money_ledger.py` — `ingest` / `commit` / `metrics` (all money math lives here; never compute totals yourself)

## Steps

### 1. Parse

```bash
python tools/parse_rbc.py .tmp/monthly-money/YYYY-MM/*.csv -o .tmp/monthly-money/YYYY-MM/rbc.json
```

For each Rogers screenshot: read the image and transcribe every visible transaction into the same normalized JSON shape, in a file like `rogers.json`:

```json
{"date": "YYYY-MM-DD", "account": "Rogers Mastercard", "description": "as printed", "amount": -12.34, "source": "rogers_screenshot"}
```

Charges are negative, payments/credits positive. Statement rows usually print charges as positive numbers — flip the sign. **Vision is the one probabilistic step in this workflow**, so verify it: tell the user the transaction count and the sum you transcribed and ask them to confirm both against the screenshot before proceeding. If the image is too blurry to read confidently, say so and ask for a better shot rather than guessing.

### 2. Ingest

```bash
python tools/money_ledger.py ingest .tmp/monthly-money/YYYY-MM/rbc.json .tmp/monthly-money/YYYY-MM/rogers.json \
  --month YYYY-MM --staged .tmp/monthly-money/YYYY-MM/staged.json
```

The summary reports duplicates skipped (safe to re-run with overlapping exports), auto-excluded transfers/CC payments, auto-categorized counts, and — the part that needs you — `unknown_merchants` and `unknown_recipients`.

Add `--month-only` if the export deliberately spans extra months you don't want (normally you want everything — a few days' spillover from the statement boundary is fine and lands in its own month).

### 3. Resolve unknowns with the user

Batch ALL unknown merchants and recipients into as few `AskUserQuestion` rounds as possible (~4 merchants per call; the first month may legitimately take 4–5 rounds — that's expected, and memory makes later months one round or zero). For each, show the merchant/recipient with an example transaction (date + amount helps recognition) and offer likely categories from `finances/config.json` — put your best guess first. Ask two things implicitly per merchant: category, and whether it's a business expense (offer "Business" as a category option; anything categorized Business gets `business: true`).

Write every answer into `finances/memory.json`:

```json
"merchants":  {"MERCHANT KEY": {"category": "Groceries", "business": false}},
"recipients": {"JANE DOE":     {"category": "Housing"}}
```

Keys are the normalized names exactly as the ingest summary printed them. Use category `"EXCLUDE"` for anything that isn't real spending (e.g. e-transfer to his own account at another bank). This memory is why month 2 asks less than month 1 — never skip writing it back.

### 4. Commit to ledger

```bash
python tools/money_ledger.py commit --staged .tmp/monthly-money/YYYY-MM/staged.json
```

Re-categorizes from the updated memory and appends to `finances/ledger.csv`. Anything still unresolved lands as `Uncategorized` and is reported — mention it on the dashboard rather than blocking.

### 5. Metrics

```bash
python tools/money_ledger.py metrics --month YYYY-MM
```

Emits the full metrics JSON: cash flow, per-category totals with MoM delta and 3-month average, recurring charges with price creep, top merchants, big-ticket items, budget vs actual (or `budget_proposal` when no targets exist yet), freed-for-business history, business section. Render the dashboard from this JSON only — do not recompute or "fix" numbers by hand; if a number looks wrong, that's a tool bug to fix (see Self-improvement).

### 6. Budgets

- **Baseline month** (`is_baseline_month: true` or empty `budgets.targets`): metrics includes `budget_proposal` — baseline spending with discretionary categories trimmed to 85%, rounded to $5. Present it via `AskUserQuestion` (accept as-is / adjust), write approved numbers to `finances/budgets.json` `targets`, then **re-run metrics** so the dashboard renders the approved budget vs actual instead of a stale proposal.
- **Later months**: dashboard shows budget vs actual per category. If he's consistently over/under somewhere by a wide margin, suggest a target adjustment — budgets should track reality or they get ignored.

### 7. Render the dashboard

Load the **dataviz skill first** (chart form, color, and layout rules), then build the HTML per `workflows/references/dashboard-spec.md`. Write it to `.tmp/monthly-money/YYYY-MM/dashboard.html`.

### 8. Publish

1. **Evergreen artifact**: call `Artifact` with `action: "list"` and look for the existing **"Monthly Money"** artifact; pass its `url` when publishing so the link stays the same every month. First run ever: publish fresh (no `url`), favicon `"💸"`, title `Monthly Money`. Keep title and favicon stable across months.
2. **Archive**: copy the HTML to `finances/reports/YYYY-MM.html` (this one IS committed — it's the historical record).

### 9. Wrap up

1. `graphify update .`
2. Commit `finances/` changes (ledger, memory, budgets, report snapshot) with a message like `monthly-money: 2026-07 review`. Never commit `.tmp/`.
3. Push per repo git rules.
4. Reply with: the evergreen dashboard link, the freed-for-business number, the top 2–3 things that changed, and anything that needs his attention (price creep, over-budget categories, uncategorized leftovers).

## Edge cases

- **Overlapping exports / re-runs**: ingest dedupes by content hash against the ledger — re-running a month or re-uploading a wider date range is safe.
- **Duplicate identical purchases** (two same-price coffees, same day): kept — dedupe uses an occurrence index, not just content.
- **USD transactions**: RBC exports may fill the USD$ column instead of CAD$. These are excluded from CAD totals and listed in `usd_transactions` — surface them on the dashboard as a footnote.
- **Refunds**: positive amounts at known merchants net against that category's spend automatically.
- **Missing Rogers screenshot**: run without it, note "Rogers card not included" prominently on the dashboard, and remind him next run.
- **Payroll not detected**: if income is 0 or obviously missing, ask the user which deposit line is pay and add its wording to `payroll_patterns` in `finances/config.json`.

## Self-improvement loop

When a tool errors or a number is wrong: read the trace, fix the script, re-run to verify, then record what you learned below. Tools are cheap to fix; silent workarounds rot the system.

## Future hooks (agreed, not built)

- **Stripe income**: when the business gets clients, add a `tools/pull_stripe.py` and an income-by-source section.
- **Scheduled reminder**: if he keeps forgetting to run it, offer a monthly Routine that pings for exports on the 1st.
- **Google Sheets ledger mirror**: if browsing `ledger.csv` in the repo proves annoying.

## Learnings

<!-- Append dated entries: format quirks, parsing failures, decisions. Newest first. -->

- 2026-07-08 (first real run — 6-month PDF deep dive): **PDF statements are Andrew's actual input format**, not CSV exports. `tools/parse_rbc_pdf.py` parses both RBC Mastercard and chequing statement PDFs with per-file verification (MC: purchases/credits/balance summary; chequing: running-balance replay proves each row's direction). Use it whenever inputs are PDFs; fall back to CSV/parse_rbc.py if he ever exports those instead. Quirks learned: MC period line omits the start year when both dates share it; chequing "Online Banking transfer - NNNN" is the RBC MC payment (excluded — amounts match MC statement balances) while "Online Banking payment - NNNN ROGERS BANK / VISA TD BANK" are external cards (Rogers Card category / Debt Payments per Andrew); e-transfer descriptions carry a 6-char confirmation code (stripped for recipient memory) and "e-Transfer Request Fulfilled" is a real prefix; RBC pre-converts foreign charges to CAD with a "FOREIGN CURRENCY … EXCHANGE RATE" suffix (merchant_key truncates it); payroll descriptor is "Payroll Deposit CACTUSCLUBCAFEB". Environment: fresh containers need `pip install --upgrade cffi` before pypdf imports.
- 2026-07-08: The evergreen artifact URL is recorded in `finances/memory.json` under `evergreen_artifact` — pass it as `url` when republishing from any future session so the link never changes.
- 2026-07-08: `money_ledger.py metrics` budget_proposal only covers categories active in the target month — for the baseline deep dive we proposed from Jan–May full-month averages by script instead. Worth fixing in the tool eventually.

- 2026-07-08: Synthetic-data eval (3 scenarios, with-skill vs no-skill): all ground-truth totals reconciled exactly. Fixes applied from the runs: price-creep flags restricted to fixed-price categories (was flagging grocery/gas variance), `recurring_total_monthly` and freed-for-business MoM delta added to metrics, e-transfers removed from top-merchants (rent dwarfed the scale), budgets now approved *before* the dashboard renders (re-run metrics after writing targets), USD rows carry category/business so a USD business expense stays visible.
- 2026-07-08: The graphify CLI is not installed in cloud containers even though repo hooks demand it — when `graphify` is unavailable, skip `graphify update .` and note it in the commit message rather than failing the run.
- 2026-07-08: Initial build. RBC CSV column set assumed as `"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"` — verify against the first real export and update `tools/parse_rbc.py` + this note if it differs.

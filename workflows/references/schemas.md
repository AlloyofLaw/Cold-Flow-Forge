# Data schemas — monthly money workflow

Sign convention everywhere: **negative = money out, positive = money in**.

## Normalized transaction (parser output / vision transcription)

```json
{
  "date": "2026-06-15",
  "account": "Chequing ****1234",
  "description": "raw text as exported/printed",
  "amount": -54.23,
  "source": "rbc_csv | rogers_screenshot",
  "currency": "CAD"
}
```

`currency` is only set to `"USD"` by the parser when RBC filled the USD$ column; omitted means CAD.

## Staged transaction (after `ingest`)

Adds: `id` (16-hex content hash + occurrence index), `merchant` (normalized key), `recipient` (e-transfers only), `category` (`null` = ask the user, `"EXCLUDE"` = transfer/CC payment, dropped at commit), `business` (bool).

## finances/ledger.csv

Columns: `id,date,month,account,source,description,merchant,recipient,category,business,amount,currency`. Append-only via `money_ledger.py commit` — never edit by hand except to fix a miscategorization (safe: metrics recomputes from the file).

## finances/memory.json

```json
{
  "merchants":  {"TIM HORTONS": {"category": "Dining & Takeout", "business": false}},
  "recipients": {"JANE DOE": {"category": "Housing"}}
}
```

Keys are normalized (uppercase, store numbers stripped) exactly as ingest prints them. Prefix matching applies both directions, so `TIM HORTONS` covers `TIM HORTONS 4821`. `"category": "EXCLUDE"` removes matches from analysis.

## finances/config.json

- `categories`: `{name: {type: "income" | "essential" | "discretionary" | "business"}}` — type drives the freed-for-business math and budget-proposal weighting
- `payroll_patterns` / `exclude_patterns`: case-insensitive substrings matched against normalized descriptions
- `big_ticket_threshold`: dollars; `currency`: display currency

## finances/budgets.json

```json
{"targets": {"Groceries": 450, "Dining & Takeout": 200}}
```

Empty `targets` ⇒ metrics emits `budget_proposal` instead of `budget_vs_actual`.

## metrics JSON (dashboard input)

Top-level keys: `month`, `currency`, `months_in_ledger`, `is_baseline_month`, `cash_flow {income, personal_spend, business_spend, net}`, `freed_for_business {current, definition, history[]}`, `categories[] {category, type, total, previous, mom_delta, avg_3mo, vs_avg}`, `business {total, by_merchant}`, `recurring[] {merchant, category, monthly_cost, months_seen, previous_cost, price_creep}`, `top_merchants[]`, `big_ticket[]`, `budget_vs_actual[] | null`, `budget_proposal | null`, `uncategorized_count`, `usd_transactions[]`.

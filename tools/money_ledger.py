#!/usr/bin/env python3
"""Deterministic ledger engine for the monthly money workflow.

All money math lives here, not in the model. Three subcommands:

  ingest   Normalize a batch of parsed transactions for one month:
           dedupe (within batch and against the ledger), auto-exclude
           transfers / credit-card payments, categorize from
           finances/memory.json, and write a staged file. The summary
           printed to stdout tells the agent which merchants/recipients
           are unknown and need the user's input.

  commit   Re-categorize the staged file from (possibly updated) memory
           and append it to finances/ledger.csv.

  metrics  Compute the full metrics JSON for a month: cash flow,
           category totals with MoM + 3-month average, recurring-charge
           detection with price creep, top merchants, big-ticket items,
           budget vs actual (or a proposed budget when none exists), and
           the "freed for business" history.

State files (all under --root, default: repo root):
  finances/config.json   categories, exclusion patterns, payroll patterns, thresholds
  finances/memory.json   merchant -> category/business, e-transfer recipient -> category
  finances/ledger.csv    every kept transaction, appended monthly
  finances/budgets.json  per-category monthly targets

Sign convention: negative = money out, positive = money in.
Categorizing a merchant or recipient as "EXCLUDE" in memory removes it
from analysis (e.g. moving money to your own investment account).
"""

import argparse
import csv
import hashlib
import json
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

LEDGER_COLUMNS = [
    "id", "date", "month", "account", "source", "description",
    "merchant", "recipient", "category", "business", "amount", "currency",
]

ETRANSFER_MARKERS = ("E-TRF", "E-TRANSFER", "ETRANSFER", "INTERAC")
ETRANSFER_PREFIXES = (
    "INTERAC E-TRF- ", "INTERAC E-TRF ", "E-TRANSFER SENT ", "E-TRANSFER RECEIVED ",
    "E-TRANSFER - AUTODEPOSIT ", "E-TRANSFER TO ", "E-TRANSFER FROM ",
    "E-TRANSFER ", "INTERAC E-TRANSFER ", "SEND E-TFR ",
)


# ---------------------------------------------------------------- helpers

def norm(text):
    """Uppercase, collapse whitespace, strip punctuation noise."""
    text = re.sub(r"[^A-Z0-9&' ]+", " ", (text or "").upper())
    return re.sub(r"\s+", " ", text).strip()


def merchant_key(description):
    """Merchant identity for memory lookups: normalized description with
    trailing store/reference numbers dropped (TIM HORTONS #4821 -> TIM HORTONS)."""
    words = norm(description).split()
    while words and (words[-1].isdigit() or re.fullmatch(r"[A-Z]{0,2}\d{2,}", words[-1])):
        words.pop()
    return " ".join(words)


def is_etransfer(description):
    # match on the raw uppercase text — norm() strips the hyphens these markers rely on
    d = (description or "").upper()
    return any(marker in d for marker in ETRANSFER_MARKERS)


def etransfer_recipient(description):
    d = norm(description)
    for prefix in ETRANSFER_PREFIXES:
        p = norm(prefix)
        if d.startswith(p):
            return d[len(p):].strip()
    # fall back: drop leading e-transfer-ish tokens
    words = [w for w in d.split() if w not in ("INTERAC", "E", "TRF", "E-TRF", "ETRANSFER", "SENT", "RCVD", "RECEIVED", "AUTODEPOSIT")]
    return " ".join(words).strip()


def load_json(path, default):
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def month_of(date_str):
    return date_str[:7]


class Store:
    def __init__(self, root):
        self.root = Path(root)
        fin = self.root / "finances"
        self.config = load_json(fin / "config.json", {})
        self.memory_path = fin / "memory.json"
        self.memory = load_json(self.memory_path, {"merchants": {}, "recipients": {}})
        self.budgets = load_json(fin / "budgets.json", {})
        self.ledger_path = fin / "ledger.csv"

    def ledger_rows(self):
        if not self.ledger_path.exists():
            return []
        with open(self.ledger_path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        for r in rows:
            r["amount"] = float(r["amount"])
            r["business"] = r["business"] == "true"
        return rows

    def category_type(self, category):
        return self.config.get("categories", {}).get(category, {}).get("type", "discretionary")


# ---------------------------------------------------------------- categorize

def lookup(memory_map, key):
    """Exact match, then longest prefix match either direction — so
    'TIM HORTONS 4821' finds a 'TIM HORTONS' entry and vice versa."""
    if not key:
        return None
    if key in memory_map:
        return memory_map[key]
    candidates = [k for k in memory_map
                  if len(k) >= 4 and (key.startswith(k) or k.startswith(key))]
    if candidates:
        return memory_map[max(candidates, key=len)]
    return None


def categorize(txn, store):
    """Fill category/business/recipient on a staged txn from config + memory.
    Returns the txn; category is None when the user needs to be asked."""
    desc_norm = norm(txn["description"])
    txn["merchant"] = merchant_key(txn["description"])
    txn["recipient"] = ""
    txn["business"] = False
    txn["category"] = None

    # e-transfers are checked before exclude patterns: "e-Transfer to X" must hit
    # recipient memory, not get swallowed by the generic TRANSFER TO exclusion
    if is_etransfer(txn["description"]):
        txn["recipient"] = etransfer_recipient(txn["description"])
        entry = lookup(store.memory.get("recipients", {}), txn["recipient"])
        if entry:
            txn["category"] = entry.get("category")
            txn["business"] = bool(entry.get("business", False))
        return txn

    for pattern in store.config.get("exclude_patterns", []):
        if norm(pattern) in desc_norm:
            txn["category"] = "EXCLUDE"
            return txn

    entry = lookup(store.memory.get("merchants", {}), txn["merchant"])
    if entry:
        txn["category"] = entry.get("category")
        txn["business"] = bool(entry.get("business", False))
        return txn

    if txn["amount"] > 0:
        for pattern in store.config.get("payroll_patterns", []):
            if norm(pattern) in desc_norm:
                txn["category"] = "Income"
                return txn
    return txn


def assign_ids(txns, existing_ids):
    """Stable ids: hash of (account, date, amount, description) plus an
    occurrence index so two identical same-day coffees both survive, while
    the same transaction re-imported from an overlapping export dedupes."""
    seen = defaultdict(int)
    kept, dupes = [], 0
    for t in sorted(txns, key=lambda t: (t["date"], t["account"], norm(t["description"]), t["amount"])):
        tup = (t["account"], t["date"], f"{t['amount']:.2f}", norm(t["description"]))
        occurrence = seen[tup]
        seen[tup] += 1
        t["id"] = hashlib.sha1("|".join(tup + (str(occurrence),)).encode()).hexdigest()[:16]
        if t["id"] in existing_ids:
            dupes += 1
        else:
            kept.append(t)
    return kept, dupes


# ---------------------------------------------------------------- ingest / commit

def cmd_ingest(args, store):
    txns = []
    for path in args.transactions:
        txns.extend(load_json(Path(path), []))
    if args.month_only and args.month:
        txns = [t for t in txns if month_of(t["date"]) == args.month]
    if not txns:
        print(json.dumps({"error": "no transactions to ingest"}))
        return 1

    existing_ids = {r["id"] for r in store.ledger_rows()}
    kept, dupes = assign_ids(txns, existing_ids)
    for t in kept:
        categorize(t, store)
        t.setdefault("currency", "CAD")

    staged_path = Path(args.staged)
    staged_path.parent.mkdir(parents=True, exist_ok=True)
    with open(staged_path, "w", encoding="utf-8") as f:
        json.dump(kept, f, indent=2)

    unknown_merchants = sorted({
        t["merchant"] for t in kept
        if t["category"] is None and not t["recipient"] and t["merchant"]
    })
    unknown_recipients = sorted({
        t["recipient"] for t in kept if t["category"] is None and t["recipient"]
    })
    summary = {
        "staged": str(staged_path),
        "kept": len(kept),
        "duplicates_skipped": dupes,
        "excluded": sum(1 for t in kept if t["category"] == "EXCLUDE"),
        "auto_categorized": sum(1 for t in kept if t["category"] not in (None, "EXCLUDE")),
        "needs_input": sum(1 for t in kept if t["category"] is None),
        "unknown_merchants": [
            {"merchant": m,
             "examples": [
                 {"date": t["date"], "description": t["description"], "amount": t["amount"]}
                 for t in kept if t["merchant"] == m][:3]}
            for m in unknown_merchants],
        "unknown_recipients": [
            {"recipient": r,
             "examples": [
                 {"date": t["date"], "description": t["description"], "amount": t["amount"]}
                 for t in kept if t["recipient"] == r][:3]}
            for r in unknown_recipients],
        "months_present": sorted({month_of(t["date"]) for t in kept}),
    }
    print(json.dumps(summary, indent=2))
    return 0


def cmd_commit(args, store):
    with open(args.staged, encoding="utf-8") as f:
        staged = json.load(f)

    still_unknown = []
    for t in staged:
        if t.get("category") is None:
            categorize(t, store)  # memory may have been updated since ingest
        if t["category"] is None:
            t["category"] = "Uncategorized"
            still_unknown.append(t["merchant"] or t["recipient"] or t["description"])

    existing_ids = {r["id"] for r in store.ledger_rows()}
    rows = [t for t in staged
            if t["category"] != "EXCLUDE" and t["id"] not in existing_ids]

    write_header = not store.ledger_path.exists()
    store.ledger_path.parent.mkdir(parents=True, exist_ok=True)
    with open(store.ledger_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LEDGER_COLUMNS)
        if write_header:
            writer.writeheader()
        for t in sorted(rows, key=lambda t: t["date"]):
            writer.writerow({
                "id": t["id"], "date": t["date"], "month": month_of(t["date"]),
                "account": t["account"], "source": t["source"],
                "description": t["description"], "merchant": t["merchant"],
                "recipient": t.get("recipient", ""), "category": t["category"],
                "business": "true" if t.get("business") else "false",
                "amount": f"{t['amount']:.2f}", "currency": t.get("currency", "CAD"),
            })
    print(json.dumps({
        "appended": len(rows),
        "excluded_dropped": sum(1 for t in staged if t["category"] == "EXCLUDE"),
        "still_uncategorized": sorted(set(still_unknown)),
        "ledger": str(store.ledger_path),
    }, indent=2))
    return 0


# ---------------------------------------------------------------- metrics

def spend_by(rows, key_fn):
    """Net spend per key over expense rows (positive number = money spent).
    Refunds (positive amounts at expense categories) net against spending."""
    totals = defaultdict(float)
    for r in rows:
        totals[key_fn(r)] += -r["amount"]
    return {k: round(v, 2) for k, v in totals.items()}


def cmd_metrics(args, store):
    rows = [r for r in store.ledger_rows() if r.get("currency", "CAD") == "CAD"]
    usd_rows = [r for r in store.ledger_rows() if r.get("currency") == "USD"]
    if not rows:
        print(json.dumps({"error": "ledger is empty — run ingest/commit first"}))
        return 1

    months = sorted({r["month"] for r in rows})
    month = args.month or months[-1]
    prior = [m for m in months if m < month]
    prev_month = prior[-1] if prior else None
    avg_months = prior[-3:]

    def month_rows(m):
        return [r for r in rows if r["month"] == m]

    cur = month_rows(month)
    income_rows = [r for r in cur if r["category"] == "Income"]
    expense_rows = [r for r in cur if r["category"] != "Income"]
    personal = [r for r in expense_rows if not r["business"]]
    business = [r for r in expense_rows if r["business"]]

    income = round(sum(r["amount"] for r in income_rows), 2)
    personal_spend = round(sum(-r["amount"] for r in personal), 2)
    business_spend = round(sum(-r["amount"] for r in business), 2)

    # -- category table with MoM and 3-month average (personal only;
    # business is its own section so it never pollutes personal budgets)
    def personal_cat_totals(m):
        return spend_by([r for r in month_rows(m)
                         if r["category"] != "Income" and not r["business"]],
                        lambda r: r["category"])

    cur_cats = personal_cat_totals(month)
    prev_cats = personal_cat_totals(prev_month) if prev_month else {}
    avg_cats = defaultdict(list)
    for m in avg_months:
        for cat, total in personal_cat_totals(m).items():
            avg_cats[cat].append(total)
    categories = []
    for cat in sorted(set(cur_cats) | set(prev_cats), key=lambda c: -cur_cats.get(c, 0)):
        avg = round(statistics.mean(avg_cats[cat]), 2) if avg_cats.get(cat) else None
        categories.append({
            "category": cat,
            "type": store.category_type(cat),
            "total": cur_cats.get(cat, 0.0),
            "previous": prev_cats.get(cat) if prev_month else None,
            "mom_delta": round(cur_cats.get(cat, 0) - prev_cats.get(cat, 0), 2) if prev_month else None,
            "avg_3mo": avg,
            "vs_avg": round(cur_cats.get(cat, 0) - avg, 2) if avg is not None else None,
        })

    # -- recurring charges: same merchant in >=2 of the last 3 months with
    # stable amounts, or anything in the Subscriptions category
    recurring = []
    window = ([m for m in months if m <= month])[-4:]
    by_merchant = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if r["month"] in window and r["category"] != "Income" and r["amount"] < 0:
            by_merchant[r["merchant"] or r["recipient"]][r["month"]].append(-r["amount"])
    for merchant, per_month in by_merchant.items():
        if month not in per_month:
            continue
        months_seen = sorted(per_month)
        charges = [sum(v) for v in per_month.values()]
        stable = max(charges) - min(charges) <= 0.15 * max(statistics.median(charges), 1)
        cat = next((r["category"] for r in cur if (r["merchant"] or r["recipient"]) == merchant), "")
        if (len(months_seen) >= 2 and stable) or cat == "Subscriptions":
            current = round(sum(per_month[month]), 2)
            prev_charge = (round(sum(per_month[months_seen[-2]]), 2)
                           if len(months_seen) >= 2 else None)
            # price creep only makes sense for fixed-price charges; variable
            # spend (groceries, gas) recurring at the same merchant is not a
            # price increase, just a different basket
            creep_cats = {"Subscriptions", "Utilities/Phone", "Health", "Housing", "Debt Payments"}
            recurring.append({
                "merchant": merchant, "category": cat,
                "monthly_cost": current, "months_seen": months_seen,
                "previous_cost": prev_charge,
                "price_creep": (round(current - prev_charge, 2)
                                if prev_charge and cat in creep_cats
                                and current > prev_charge * 1.01 else None),
            })
    recurring.sort(key=lambda r: -r["monthly_cost"])
    recurring_total = round(sum(r["monthly_cost"] for r in recurring), 2)

    # -- budgets: actuals vs targets, or a proposal from baseline when unset.
    # Proposed cuts land on discretionary categories (85%); essentials keep 100%.
    budget_section = None
    proposal = None
    if store.budgets.get("targets"):
        targets = store.budgets["targets"]
        budget_section = [{
            "category": cat, "target": target,
            "actual": cur_cats.get(cat, 0.0),
            "remaining": round(target - cur_cats.get(cat, 0.0), 2),
            "over": cur_cats.get(cat, 0.0) > target,
        } for cat, target in sorted(targets.items(), key=lambda kv: -kv[1])]
    else:
        baseline = {}
        for cat in cur_cats:
            samples = avg_cats.get(cat, []) + [cur_cats[cat]]
            baseline[cat] = statistics.mean(samples)
        proposal = {
            cat: round(base * (0.85 if store.category_type(cat) == "discretionary" else 1.0) / 5) * 5
            for cat, base in baseline.items() if base > 0
        }

    threshold = store.config.get("big_ticket_threshold", 200)
    freed_history = []
    for m in months:
        m_rows = month_rows(m)
        m_income = sum(r["amount"] for r in m_rows if r["category"] == "Income")
        m_personal = sum(-r["amount"] for r in m_rows
                         if r["category"] != "Income" and not r["business"])
        freed_history.append({"month": m, "freed": round(m_income - m_personal, 2)})

    metrics = {
        "month": month,
        "currency": store.config.get("currency", "CAD"),
        "months_in_ledger": months,
        "is_baseline_month": prev_month is None,
        "cash_flow": {
            "income": income,
            "personal_spend": personal_spend,
            "business_spend": business_spend,
            "net": round(income - personal_spend - business_spend, 2),
        },
        "freed_for_business": {
            "current": round(income - personal_spend, 2),
            "previous": next((h["freed"] for h in freed_history if h["month"] == prev_month), None),
            "mom_delta": (round((income - personal_spend)
                                - next(h["freed"] for h in freed_history if h["month"] == prev_month), 2)
                          if prev_month else None),
            "definition": "income minus all personal spending — what was available to redirect to the business",
            "history": freed_history,
        },
        "categories": categories,
        "business": {
            "total": business_spend,
            "by_merchant": spend_by(business, lambda r: r["merchant"] or r["recipient"]),
        },
        "recurring": recurring,
        "recurring_total_monthly": recurring_total,
        # e-transfers (rent etc.) are payments to people, not merchants, and
        # they dwarf the merchant bar scale — keep the list to actual merchants
        "top_merchants": sorted(
            ({"merchant": k, "total": v} for k, v in
             spend_by([r for r in expense_rows if r["amount"] < 0 and not r["recipient"]],
                      lambda r: r["merchant"]).items()),
            key=lambda x: -x["total"])[:10],
        "big_ticket": sorted(
            ({"date": r["date"], "merchant": r["merchant"] or r["recipient"],
              "description": r["description"], "amount": round(-r["amount"], 2),
              "category": r["category"]}
             for r in expense_rows if r["amount"] <= -threshold),
            key=lambda x: -x["amount"]),
        "budget_vs_actual": budget_section,
        "budget_proposal": proposal,
        "uncategorized_count": sum(1 for r in cur if r["category"] == "Uncategorized"),
        "usd_transactions": [
            {"date": r["date"], "description": r["description"], "amount": r["amount"],
             "category": r["category"], "business": r["business"]}
            for r in usd_rows if r["month"] == month],
    }
    print(json.dumps(metrics, indent=2))
    return 0


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description="Deterministic ledger engine for the monthly money workflow")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[1]),
                    help="repo root containing finances/ (default: this repo)")
    sub = ap.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest", help="stage + categorize a month's parsed transactions")
    p_ingest.add_argument("transactions", nargs="+", help="normalized transaction JSON file(s)")
    p_ingest.add_argument("--month", help="expected month YYYY-MM (informational)")
    p_ingest.add_argument("--month-only", action="store_true",
                          help="drop transactions outside --month (overlapping exports)")
    p_ingest.add_argument("--staged", required=True, help="path to write the staged JSON")

    p_commit = sub.add_parser("commit", help="append a staged file to the ledger")
    p_commit.add_argument("--staged", required=True)

    p_metrics = sub.add_parser("metrics", help="compute metrics JSON for a month")
    p_metrics.add_argument("--month", help="YYYY-MM (default: latest month in ledger)")

    args = ap.parse_args(argv)
    store = Store(args.root)
    return {"ingest": cmd_ingest, "commit": cmd_commit, "metrics": cmd_metrics}[args.command](args, store)


if __name__ == "__main__":
    sys.exit(main())

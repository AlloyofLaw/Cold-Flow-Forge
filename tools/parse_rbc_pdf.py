#!/usr/bin/env python3
"""Parse RBC PDF statements (Mastercard + chequing) into normalized
transaction JSON — same output shape as parse_rbc.py.

Every file is verified against the statement's own printed figures before
its transactions are accepted:
  - Mastercard: sum of charges == "Purchases & debits", sum of credits ==
    "Payments & credits", and previous balance + purchases - payments ==
    "NEW BALANCE".
  - Chequing: the running Balance column is replayed row by row from the
    opening balance (this also *proves* each row's withdrawal/deposit
    direction), and totals must equal "Total deposits/withdrawals" and the
    closing balance.
A file that fails verification is rejected loudly — never silently kept.

Usage:
    python tools/parse_rbc_pdf.py statement1.pdf ... -o out.json

Requires pypdf (text-layer PDFs only; scanned statements need the vision
path in the workflow instead).
"""

import argparse
import itertools
import json
import re
import sys
from datetime import date

from pypdf import PdfReader

MONTHS = {m: i + 1 for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}
FULL_MONTHS = {m: i + 1 for i, m in enumerate(
    ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST",
     "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"])}
MONEY = re.compile(r"^\d{1,3}(?:,\d{3})*\.\d{2}$")

DEPOSIT_HINTS = ("PAYROLL", "DEPOSIT", "GST", "WORKERS BENEFIT", "E-TRANSFER RECEIVED",
                 "REFUND", "REVERSAL", "INTEREST PAID", "CHILD BENEFIT", "TAX REFUND")


class StatementError(Exception):
    pass


def money(s):
    return round(float(s.replace(",", "").replace("$", "")), 2)


def pdf_text(path):
    return "\n<<<PAGE>>>\n".join((p.extract_text() or "") for p in PdfReader(path).pages)


def year_for(month_num, start, end):
    """Assign a year to a bare month using the statement period endpoints."""
    if month_num == start[1]:
        return start[0]
    if month_num == end[1]:
        return end[0]
    # month strictly inside the period (can't happen for RBC's ~30-day windows,
    # but keep it sane): pick the year that keeps the date within the period
    return start[0] if month_num > start[1] else end[0]


# ---------------------------------------------------------------- mastercard

MC_TXN = re.compile(r"^([A-Z]{3}) (\d{1,2}) ([A-Z]{3}) (\d{1,2}) (.*)$")
MC_AMOUNT = re.compile(r"^(-?)\$([\d,]+\.\d{2})$")
# start-date year is omitted when both dates share it: "FROM APR 22 TO MAY 21, 2026"
MC_PERIOD = re.compile(r"STATEMENT FROM ([A-Z]{3}) (\d{1,2})(?:, (\d{4}))? TO ([A-Z]{3}) (\d{1,2}), (\d{4})")


def parse_mastercard(text, path):
    pm = MC_PERIOD.search(text)
    if not pm:
        raise StatementError(f"{path}: no STATEMENT FROM ... TO ... period line")
    end = (int(pm.group(6)), MONTHS[pm.group(4)])
    if pm.group(3):
        start_year = int(pm.group(3))
    else:  # year omitted on the start date; a Dec->Jan span crosses the year boundary
        start_year = end[0] - 1 if MONTHS[pm.group(1)] > end[1] else end[0]
    start = (start_year, MONTHS[pm.group(1)])

    card = re.search(r"(\d{4}) \d{2}\*\* \*\*\*\* (\d{4})", text)
    account = f"Mastercard ****{card.group(2)}" if card else "Mastercard"

    txns, current = [], None
    for raw in text.splitlines():
        line = raw.strip()
        m = MC_TXN.match(line)
        if m and m.group(1) in MONTHS and m.group(3) in MONTHS:
            if current:
                raise StatementError(f"{path}: transaction without amount: {current['description']!r}")
            mon = MONTHS[m.group(1)]
            current = {
                "date": date(year_for(mon, start, end), mon, int(m.group(2))).isoformat(),
                "account": account,
                "description": m.group(5).strip(),
                "source": "rbc_pdf",
            }
            continue
        if current is None:
            continue
        am = MC_AMOUNT.match(line)
        if am:
            stmt_amount = money(am.group(2)) * (-1 if am.group(1) else 1)
            current["amount"] = round(-stmt_amount, 2)  # charge -> money out
            txns.append(current)
            current = None
        elif re.fullmatch(r"\d{8,}", line):
            pass  # reference number
        elif line:
            current["description"] += " " + line
    if current:
        raise StatementError(f"{path}: dangling transaction {current['description']!r}")

    # verification against the statement's own math
    def grab(label):
        m = re.search(re.escape(label) + r"\s+(-?)\$([\d,]+\.\d{2})", text)
        if not m:
            raise StatementError(f"{path}: missing '{label}' summary line")
        return money(m.group(2)) * (-1 if m.group(1) else 1)

    purchases = grab("Purchases & debits")
    payments = grab("Payments & credits")            # printed negative
    prev_bal = grab("Previous Account Balance")
    new_bal = grab("NEW BALANCE")
    interest, fees, advances = grab("Interest"), grab("Fees"), grab("Cash advances")

    charges = round(sum(-t["amount"] for t in txns if t["amount"] < 0), 2)
    credits = round(sum(t["amount"] for t in txns if t["amount"] > 0), 2)
    checks = {
        "purchases_match": charges == round(purchases + advances, 2),
        "credits_match": credits == -payments,
        "balance_match": round(prev_bal + purchases + advances + interest + fees + payments, 2) == new_bal,
    }
    if not all(checks.values()):
        raise StatementError(
            f"{path}: verification failed {checks}: parsed charges={charges} vs purchases={purchases}, "
            f"parsed credits={credits} vs payments={-payments}")
    if interest or fees:
        # interest/fees are real money out but have no transaction row; surface them
        for label, amt in (("INTEREST CHARGE", interest), ("CARD FEES", fees)):
            if amt:
                txns.append({"date": date(end[0], end[1], int(pm.group(5))).isoformat(),
                             "account": account, "description": label,
                             "amount": round(-amt, 2), "source": "rbc_pdf"})
    return txns, {"file": path, "type": "mastercard", "txns": len(txns),
                  "charges": charges, "credits": credits, "verified": True}


# ---------------------------------------------------------------- chequing

CHQ_PERIOD = re.compile(r"From (\w+) (\d{1,2}), (\d{4}) to (\w+) (\d{1,2}), (\d{4})")
CHQ_DATE = re.compile(r"^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b\s*(.*)$")
SECTION_START = re.compile(r"^Date Description Withdrawals")
NOISE = re.compile(r"^(Details of your account activity|Please |If you opted|TM Trademarks|® Registered|Royal |The Royal|Important information|Protect your|Never share|Cover the|Here are|[a-d]\) |or send|company or|card$|of a higher|Stay Informed|https://|\d+ of \d+|<<<PAGE>>>)")


def parse_chequing(text, path):
    pm = CHQ_PERIOD.search(text)
    if not pm:
        raise StatementError(f"{path}: no 'From ... to ...' period line")
    start = (int(pm.group(3)), FULL_MONTHS[pm.group(1).upper()])
    end = (int(pm.group(6)), FULL_MONTHS[pm.group(4).upper()])

    acct = re.search(r"Your account number:\s*([\d-]+)", text)
    digits = "".join(c for c in (acct.group(1) if acct else "") if c.isdigit())
    account = f"Chequing ****{digits[-4:]}" if len(digits) >= 4 else "Chequing"

    opening = money(re.search(r"opening balance on .*? \$([\d,]+\.\d{2})", text).group(1))
    closing = money(re.search(r"closing balance on .*? = \$([\d,]+\.\d{2})", text).group(1))
    total_dep = money(re.search(r"Total deposits into your account \+ ([\d,]+\.\d{2})", text).group(1))
    total_wd = money(re.search(r"Total withdrawals from your account - ([\d,]+\.\d{2})", text).group(1))

    # walk activity lines, buffering wrapped descriptions until an amount shows up
    rows, in_section, cur_date, pending = [], False, None, ""
    for raw in text.splitlines():
        line = raw.strip()
        if line == "<<<PAGE>>>":
            # header junk follows every page break; the activity table re-opens
            # with its own column header, and a row never wraps across pages
            # (the balance replay below would catch it if one ever did)
            if pending:
                raise StatementError(f"{path}: description wrapped across a page break: {pending!r}")
            in_section = False
            continue
        if SECTION_START.match(line):
            in_section = True
            continue
        if not in_section or not line or NOISE.match(line):
            continue
        if line.startswith("Opening Balance"):
            continue
        if line.startswith("Closing Balance"):
            in_section = False
            continue

        dm = CHQ_DATE.match(line)
        if dm:
            mon = MONTHS[dm.group(2).upper()]
            cur_date = date(year_for(mon, start, end), mon, int(dm.group(1))).isoformat()
            line = dm.group(3)
            if pending:
                raise StatementError(f"{path}: unresolved description {pending!r} before {cur_date}")
            if not line:
                continue

        tokens = line.split()
        monies = []
        while tokens and MONEY.match(tokens[-1]):
            monies.insert(0, tokens.pop())
        desc_part = " ".join(tokens)
        if not monies:
            pending = (pending + " " + desc_part).strip()
            continue
        if cur_date is None:
            raise StatementError(f"{path}: transaction before any date: {line!r}")
        desc = (pending + " " + desc_part).strip()
        pending = ""
        # first money token is the amount; a second one is the running balance
        rows.append({"date": cur_date, "description": desc,
                     "amount_abs": money(monies[0]),
                     "balance": money(monies[1]) if len(monies) > 1 else None})
        if len(monies) > 2:
            raise StatementError(f"{path}: too many amounts on row {line!r}")
    if pending:
        raise StatementError(f"{path}: unresolved trailing description {pending!r}")

    # direction: keyword prior, then PROVE it by replaying the balance column
    for r in rows:
        r["sign"] = 1 if any(h in r["description"].upper() for h in DEPOSIT_HINTS) else -1

    bal = opening
    seg = []  # rows since last checkpoint
    for r in rows:
        seg.append(r)
        if r["balance"] is None:
            continue
        target = r["balance"]
        if round(bal + sum(s["sign"] * s["amount_abs"] for s in seg), 2) != target:
            if len(seg) > 16:
                raise StatementError(f"{path}: balance mismatch in segment too large to solve at {r}")
            for flips in itertools.product((1, -1), repeat=len(seg)):
                if round(bal + sum(f * s["sign"] * s["amount_abs"] for f, s in zip(flips, seg)), 2) == target:
                    for f, s in zip(flips, seg):
                        s["sign"] *= f
                    break
            else:
                raise StatementError(f"{path}: cannot reconcile balance segment ending {r}")
        bal = target
        seg = []

    txns = [{"date": r["date"], "account": account, "description": r["description"],
             "amount": round(r["sign"] * r["amount_abs"], 2), "source": "rbc_pdf"}
            for r in rows]

    deps = round(sum(t["amount"] for t in txns if t["amount"] > 0), 2)
    wds = round(sum(-t["amount"] for t in txns if t["amount"] < 0), 2)
    checks = {
        "deposits_match": deps == total_dep,
        "withdrawals_match": wds == total_wd,
        "closing_match": round(opening + deps - wds, 2) == closing,
        "final_checkpoint": bal == closing or not rows,
    }
    if not all(checks.values()):
        raise StatementError(f"{path}: verification failed {checks}: deposits {deps} vs {total_dep}, "
                             f"withdrawals {wds} vs {total_wd}")
    return txns, {"file": path, "type": "chequing", "txns": len(txns),
                  "deposits": deps, "withdrawals": wds, "verified": True}


# ---------------------------------------------------------------- main

def parse_file(path):
    text = pdf_text(path)
    if "STATEMENT FROM" in text and "Mastercard" in text:
        return parse_mastercard(text, path)
    if "personal banking" in text and "account statement" in text:
        return parse_chequing(text, path)
    raise StatementError(f"{path}: not a recognized RBC Mastercard or chequing statement")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("pdfs", nargs="+")
    ap.add_argument("-o", "--output", help="write merged JSON here instead of stdout")
    args = ap.parse_args(argv)

    all_txns, reports = [], []
    for path in args.pdfs:
        try:
            txns, report = parse_file(path)
        except StatementError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1
        all_txns.extend(txns)
        reports.append(report)
        print(json.dumps(report), file=sys.stderr)

    all_txns.sort(key=lambda t: t["date"])
    payload = json.dumps(all_txns, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(payload + "\n")
        print(f"wrote {len(all_txns)} transactions to {args.output}", file=sys.stderr)
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())

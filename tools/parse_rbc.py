#!/usr/bin/env python3
"""Parse RBC online-banking CSV exports into normalized transaction JSON.

RBC's export format (chequing, savings, and credit cards all share it):

    "Account Type","Account Number","Transaction Date","Cheque Number",
    "Description 1","Description 2","CAD$","USD$"

Sign convention in and out: negative = money out, positive = money in.
RBC already uses this convention for both bank accounts and credit cards
(purchases negative, payments/deposits positive), so amounts pass through
unchanged.

Usage:
    python tools/parse_rbc.py export1.csv [export2.csv ...] [-o out.json]

Output: JSON array of normalized transactions:
    {"date": "2026-06-15", "account": "Chequing ****1234",
     "description": "...", "amount": -54.23, "source": "rbc_csv"}

Fails loudly with file name and row number on anything unparseable —
a silent skip would understate spending, which is worse than an error.
"""

import argparse
import csv
import json
import sys
from datetime import datetime

EXPECTED_COLUMNS = {"Account Type", "Account Number", "Transaction Date", "CAD$"}

DATE_FORMATS = ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y")


class ParseError(Exception):
    pass


def parse_date(raw, path, row_num):
    raw = raw.strip()
    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.strptime(raw, fmt)
        except ValueError:
            continue
        # %d/%m/%Y and %m/%d/%Y are ambiguous for days <= 12; RBC uses
        # month-first, which is listed first, so the first match wins.
        return parsed.strftime("%Y-%m-%d")
    raise ParseError(f"{path} row {row_num}: unrecognized date {raw!r}")


def parse_amount(raw, path, row_num):
    raw = raw.strip().replace(",", "").replace("$", "")
    if not raw:
        return None
    try:
        return round(float(raw), 2)
    except ValueError:
        raise ParseError(f"{path} row {row_num}: unrecognized amount {raw!r}")


def account_label(acct_type, acct_number):
    acct_type = acct_type.strip() or "Account"
    digits = "".join(c for c in acct_number if c.isdigit())
    suffix = f" ****{digits[-4:]}" if len(digits) >= 4 else ""
    return f"{acct_type}{suffix}"


def parse_file(path):
    transactions = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ParseError(f"{path}: file is empty")
        fields = {name.strip() for name in reader.fieldnames if name}
        missing = EXPECTED_COLUMNS - fields
        if missing:
            raise ParseError(
                f"{path}: not an RBC export — missing columns {sorted(missing)}. "
                f"Found columns: {sorted(fields)}"
            )
        for row_num, row in enumerate(reader, start=2):
            row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
            if not any(row.values()):
                continue  # trailing blank lines are common in RBC exports
            cad = parse_amount(row.get("CAD$", ""), path, row_num)
            usd = parse_amount(row.get("USD$", ""), path, row_num)
            if cad is None and usd is None:
                raise ParseError(f"{path} row {row_num}: no CAD$ or USD$ amount")
            desc = " ".join(
                part for part in (row.get("Description 1"), row.get("Description 2")) if part
            )
            txn = {
                "date": parse_date(row.get("Transaction Date", ""), path, row_num),
                "account": account_label(row.get("Account Type", ""), row.get("Account Number", "")),
                "description": desc,
                "amount": cad if cad is not None else usd,
                "source": "rbc_csv",
            }
            if cad is None:
                txn["currency"] = "USD"  # flag USD-side rows so they aren't summed as CAD
            transactions.append(txn)
    return transactions


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("csv_files", nargs="+", help="RBC CSV export file(s)")
    ap.add_argument("-o", "--output", help="write JSON here instead of stdout")
    args = ap.parse_args(argv)

    all_txns = []
    for path in args.csv_files:
        try:
            txns = parse_file(path)
        except ParseError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1
        print(f"{path}: {len(txns)} transactions", file=sys.stderr)
        all_txns.extend(txns)

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

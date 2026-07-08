---
name: monthly-money
description: Run the monthly money review — parse Andrew's RBC CSV exports and Rogers card screenshots, categorize spending with learned merchant memory, and publish the evergreen Monthly Money dashboard (cash flow, category trends, subscription audit, budget vs actual, freed-for-business). Use this whenever the user wants to review spending, asks "where did my money go", mentions budgeting or budget check-ins, uploads bank exports, statements, or transaction screenshots, mentions RBC or Rogers statements, or wants to know how much he can put toward the business — even if he doesn't say "monthly money" explicitly.
---

# Monthly Money

This skill is a thin trigger. The single source of truth is the WAT workflow:

**Read `workflows/monthly_money.md` and follow it exactly.**

That SOP covers intake (RBC CSVs + Rogers screenshots), the deterministic tools (`tools/parse_rbc.py`, `tools/money_ledger.py` — never do money math yourself), merchant-memory categorization, budget handling, dashboard rendering (`workflows/references/dashboard-spec.md`, load the dataviz skill first), evergreen-artifact publishing, and commit/push.

If the user provided bank files or screenshots in their message, start at the SOP's Parse step. If not, start at Required inputs and help them export (see `workflows/references/rbc-export-guide.md`).

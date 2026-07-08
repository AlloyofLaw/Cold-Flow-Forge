# Getting your data out of RBC (and Rogers Bank)

Walk the user through whichever of these they need. Total time is about three minutes once they've done it twice.

## RBC Online Banking (desktop — recommended)

1. Sign in at [rbcroyalbank.com](https://www.rbcroyalbank.com) → **Accounts**.
2. Click the account (do this once for chequing and once for the credit card).
3. On the account details page, find **Download** (top right of the transaction list, sometimes under "Filter & Download" or a small download icon).
4. Set the date range to the month under review — a few extra days on either side is fine, the tools dedupe and file spillover into its own month.
5. Format: **Excel (CSV)** — *not* Quicken/QuickBooks/Money formats.
6. Download and repeat for each account, then share the files in chat.

Notes:
- RBC only offers CSV download on the website, not reliably in the mobile app. Use a computer.
- The file has no header customization — it's the standard 8-column export, which `tools/parse_rbc.py` expects.
- Credit card transactions can lag a couple of days; export after the 3rd of the month for a complete prior month.

## RBC mobile app (fallback)

The app can export statements as PDF but not CSV. If desktop is impossible this month, screenshot the transaction list instead (like the Rogers flow) and flag that this month's RBC data came in via screenshots — vision transcription applies, count/total confirmation required.

## Rogers Bank card (shared with mum)

1. Open the Rogers Bank app or [rogersbank.com](https://rogersbank.com) and view the current statement.
2. Screenshot **only the section with your transactions** — crop or scroll so mum's are not in frame; whatever is in the screenshot gets counted as yours.
3. Make sure each screenshot shows date, merchant, and amount columns fully, unclipped.
4. Multiple screenshots are fine — overlap between them is deduped.

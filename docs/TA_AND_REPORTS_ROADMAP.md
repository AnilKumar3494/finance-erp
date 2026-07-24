# TA charges + iFinance report parity — roadmap

Branch: `feature/ta-charges-and-reports` (off `develop`).
Goal: bring iFinance's "TA" charge into the app AND match iFinance's report suite.

## Key findings (2026-07-21, from live iFinance API)
- **TA = Travelling Allowance** — a per-collection charge (almost always ₹200) the
  collector adds when taking an EMI. It is added at collection time (NOT on the schedule,
  NOT at finance creation), lives in a separate `taHPReceipts` stream keyed by the EMI
  receipt's `emi_dl_id`. It does NOT reduce the loan balance; it's separate income.
  Historic total: ₹73.9 L all-time; ₹6.94 L on the loans in our app.
- **Accounting side is nearly empty in iFinance:** Capitals, Income/Expense, Deposits,
  GST, Investments all zero/unregistered. iFinance's P&L + Balance Sheet (`getBalanceSheet`)
  are DERIVED from the loan book + a small bike-trading business — not a separate ledger.
  So "match all reports" needs almost no accounting-data migration, only:
  - the loan/EMI/TA data we already have, and
  - the **bike-trading** side business (BikePurchasePayments / bikeSalesReceipts /
    BikePurchaseRepairs in the day-report; ~₹97 L purchases / ₹1.03 Cr sales).
- iFinance `getBalanceSheet` headline: `cashInHand=48,681,595` (= day-report "Balance"),
  `total_financed=47.5 Cr`, `received=38.19 Cr` (= our EMI total), `hp_charges=11.13 Cr`,
  `hp_loss=2.55 Cr`.

## Model decision — TA
Add `ta_amount NUMERIC(15,2) DEFAULT 0` to `transactions` (NOT a new transaction_type).
TA rides on the EMI receipt (same event, like iFinance). Balance/cycle allocation uses
`amount` only; reports sum `ta_amount` separately.

## Phases
1. **TA end-to-end** ← in progress
   - migration `021_transaction_ta_amount.sql`; `Transaction.ta_amount` field.
   - migration-repo: `dayreport_receipts.csv` gains a `ta` column (join taHPReceipts by
     emi_dl_id); loader sets `ta_amount`.
   - report service: Day Report shows TA line; collection report includes TA.
   - API: `TransactionCreate.ta_amount`; service persists it.
   - frontend: TA field on the payment screen; TA shown in Day Report tab.
2. **Collection Report** parity (per-collector, per-date — iFinance `getSubUsers` + dates).
3. **P&L** (`reports/pnl-report`) — interest income + TA + bike-trade P&L − losses.
4. **Bike-trading migration** — scrape + load the bike business (needed for P&L/BS).
5. **Balance Sheet** (`balance-sheet/final`) — assets (loans outstanding, cash, stock) vs
   capital; reconcile `cashInHand` to iFinance.
6. **Ledger / GST / Capitals** views — mostly zero today; build to match layout.

Each phase: match iFinance's numbers to the rupee and document the reconciliation.

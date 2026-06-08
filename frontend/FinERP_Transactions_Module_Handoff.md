# Sri Adithya Finance — Transactions Module · Build Handoff

Self-contained context to build the **Transactions / Collections** module in a new chat. Paste this whole file. The Finance (Loans) module is **complete + MVP-signed-off**; this is the next module.

---

## 0. Environment & setup
- **Worktree:** `/home/ak/finance-erp-frontend/.claude/worktrees/finance-erp-fe-loans` — FE in `frontend/`, a local copy of the backend in `backend/` (the EC2 box runs the real backend; local `backend/` is NOT the server — it exists so backend edits land in the PR).
- **Node:** `export PATH=/home/ak/.nvm/versions/node/v22.17.0/bin:$PATH`. **Shell cwd resets between Bash calls** — `cd frontend/` each call or use absolute paths.
- **Verify (keep green):** `node_modules/.bin/tsc -b --noEmit` and `corepack pnpm build`. `corepack pnpm dev` regenerates `routeTree.gen.ts` after route file changes.
- **`node_modules` is a SHARED symlink** to the main repo's `frontend/node_modules`. Global pnpm is v11 but the store is v10 → a plain `pnpm add` fails with a store/virtual-store error. To add a dep:
  ```
  corepack pnpm@10 add <pkg> --virtual-store-dir /home/ak/finance-erp-frontend/frontend/node_modules/.pnpm
  ```
  (No new deps without user approval.)
- **Backend REMOTE on EC2:** `http://3.110.75.198:8000` — Swagger `/docs`, schema `/openapi.json`, API prefix `/api/v1`. For backend edits: write them into worktree `backend/` AND hand the user a copy-paste diff; the user applies on EC2 + restarts. Verify via live `/openapi.json`.
- **Auth for live API tests:** ask the user for a fresh admin bearer token (JWTs expire ~hourly). `Authorization: Bearer <token>`.

## 1. Git state
- Branch **`fast-push`**, ahead of `origin/develop`. Recent commits (this session):
  - `4979d3c` feat: re-use an existing person as guarantor/co-hirer (personnel lookup)
  - `01bb6b2` feat: payment receipt PDF + printable loan statement
  - `ae336b2` refactor: share ORG_NAME across receipt + statement
  - `21a920a` chore: company name "Sri Adithya Finance" app-wide
- `develop` is branch-protected (PR + squash-merge). Remote `git@github.com:AnilKumar3494/finance-erp.git`. **No `gh` CLI** in the sandbox → push over SSH; open PRs via compare URL `https://github.com/AnilKumar3494/finance-erp/compare/develop...fast-push?expand=1`.

## 2. Stack & conventions (locked)
Vite · React 19 · TS strict · pnpm · MUI v9 · TanStack Router/Query/Table · RHF v7 + Zod 4 · axios · dayjs. **jsPDF 4.x** now a dep (added this session for receipts).
- No hex outside `tokens.css`; use primitives wrappers (`Btn/Input/Card/ErrorBanner/FieldLabel/Spinner`); raw MUI OK for Dialog/Select/Switch/Tabs/DatePicker/Table/Chip/Alert.
- `Btn` variants: **`primary | ghost | success | danger`** (NO "secondary"); not polymorphic (use `onClick`+navigate); sizes `sm | md`. `Input` uses `hint` (not `helperText`); forwards `select`+children + arbitrary props; MUI select with RHF needs a `Controller`; has `highlight?: boolean` (yellow outline). `Card` forwards `sx`. `ErrorBanner` takes `severity="error|warning|info|success"` + `variant`.
- **Money is strings end-to-end**; `fmtINR(Number(x))` only at display (`@/lib/format`: `fmtINR`, `fmtDate`, `fmtDateTime`). Null-guard DRAFT financials.
- No emojis, no WHAT-comments. **Do NOT `git add` markdown docs** (handoff/test .md files are deliverables, not committed).
- Company name lives in `features/loans/branding.ts` (`ORG_NAME = 'Sri Adithya Finance'`) and `components/nav/navConfig.ts` (`BRAND`). Reuse, don't re-hardcode.
- After route file add/move/delete: regenerate `routeTree.gen.ts` via `corepack pnpm dev`, then typecheck. routeTree merge conflict → `git checkout --ours` then regen, never hand-merge.

## 3. The task — Transactions / Collections module
Top-level route **`src/routes/_authed/transactions.tsx` is currently a `ComingSoonPage`** stub (so are `/vehicles` and `/reports`). Build out the real module here. Three pieces, in priority order:

### A. Collections worklist (highest operational value)
A daily/overdue EMI worklist **across all loans** so collectors don't hunt loan-by-loan: which cycles are due/overdue today, by customer, with a quick "Record payment".
- **BACKEND GAP — needs a new endpoint.** Due-cycles are only queryable per-loan (`GET /due-cycles/{id}`, `GET /due-cycles/loan/{loan_id}`). There is **no aggregate "cycles due/overdue across loans"** endpoint, and `GET /transactions/` has **no date-range filter** (only loan_id/collected_by_id/status). So you must add a backend list endpoint, e.g. `GET /due-cycles?status=&due_before=&due_after=&page=` (cross-loan, joined to loan+customer for display). Write it into worktree `backend/`, give the user a diff for EC2, verify via live openapi. Check `backend/app/services/due_cycle.py` + `routes/due_cycles.py` for existing query shape.
- `GET /reports/collections?period=daily|monthly&days=N` (admin) already exists → `CollectionReport { period, total_collected, total_transactions, entries: [{ date, total_amount, transaction_count, cash, gpay, phonepe, bank_transfer, other }] }`. This is money-**collected** breakdown (good for a summary header / chart), NOT a "who owes" worklist.

### B. Edit-note / void a transaction (backend ready, FE unwired)
- `PATCH /transactions/{id}` — **require_admin**, body `{ notes }` only (`TransactionUpdate`). For correcting a note.
- `DELETE /transactions/{id}` — **require_admin**, soft delete, **FAILED transactions only** (400 "cannot delete" otherwise). This is the "void a mistake" path; a SUCCESS txn must be **failed** first (there's no un-confirm — confirm/fail are terminal from PENDING).
- Add `useUpdateTransaction` + `useDeleteTransaction` to `frontend/src/api/queries/transactions.ts` (mirror the confirm/fail hooks + `invalidateLoanLedger`), then wire "Edit note" / "Void" onto transaction rows in `features/loans/components/TransactionsTab.tsx` (admin only).

### C. Reports / dashboard (backend fully built, zero FE consumer)
The entire `/reports/*` module is live and unused: `GET /reports/{summary,loans,collections,customers,employees,customers/export,charts/collections,trends}`. `/reports` top-nav is also a ComingSoonPage. Schemas in `backend/app/schemas/report.py` (`DashboardSummary`, `LoanPortfolioReport`, `CollectionReport`, `CustomerReport`, `EmployeePerformance`). Permissions: most are `require_admin` / `require_report_access`; `/reports/customers` is audited + PII-scoped. Lower priority than A/B but high value and cheap (read-only).

## 4. Backend transactions contract (live, verified this session via openapi)
Router `backend/app/api/v1/routes/transactions.py`, prefix `/transactions`:
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/` | in-scope user | create → **PENDING**. Body `TransactionCreate`: `loan_id, amount(str), payment_mode, notes?, collected_by_id?, idempotency_key?, effective_payment_date?, due_cycle_id?` |
| GET | `/` | in-scope | filters `loan_id`, `collected_by_id`, `status` (alias), `page`, `page_size`. Returns `{ total, page, page_size, total_collected(SUCCESS sum), results }`, ordered `created_at desc`. **No date filter.** |
| GET | `/{id}` | in-scope | one |
| GET | `/loan/{loan_id}/summary` | in-scope | `LoanTransactionSummary { principal, total_payable, total_paid, total_pending, outstanding, transaction_count }` |
| POST | `/{id}/confirm` | **require_admin** | PENDING → SUCCESS; updates cycle.total_received; can move loan → AWAITING_CLOSURE |
| POST | `/{id}/fail` | **require_admin** | PENDING → FAILED |
| PATCH | `/{id}` | **require_admin** | body `{ notes }` only |
| DELETE | `/{id}` | **require_admin** | soft delete, **FAILED only** (else 400) |

Enums (`frontend/src/schemas/enums.ts` ↔ backend): `PaymentMethod = CASH | GPAY | PHONEPE | BANK_TRANSFER` (labels in `features/loans/paymentMethodLabels.ts`), `TransactionStatus = PENDING | SUCCESS | FAILED`, `TransactionType = REGULAR | DOWN_PAYMENT`, `PunctualityStatus`, `CycleStatus = UPCOMING | AWAITING_REVIEW | PAID_ON_TIME | LATE_PAYMENT | MISSED_CAPPED` (labels in `features/loans/cycleStatusMeta.ts`).

## 5. What already exists to reuse (don't rebuild)
- `frontend/src/api/queries/transactions.ts`: `useLoanTransactions`, `useLoanSummary`, `useCreateTransaction`, `useConfirmTransaction`, `useFailTransaction`, `invalidateLoanLedger(qc, loanId)` (invalidates txns+summary+dueCycles+loan detail). Types `TransactionResponse`, `TransactionCreate`, `LoanTransactionSummary`, `TransactionListResponse`. **Missing: `useUpdateTransaction`, `useDeleteTransaction`, any cross-loan list/collections hooks** — add these.
- `frontend/src/api/queries/dueCycles.ts`: `useDueCycles(loanId)`, `useClassifyCycle`, `useReclassifyCycle`. `dueCycleKeys`. (transactions.ts ↔ dueCycles.ts import each other's key factories — used only inside fns, safe ESM live binding.)
- `frontend/src/features/loans/components/RecordPaymentDialog.tsx` — `{ loanId, open, onClose }`, amount/mode/date/allocate-to-cycle/notes; **reuse for the worklist's quick-record**. Created txns are PENDING (admin confirms later).
- `frontend/src/features/loans/components/TransactionsTab.tsx` — per-loan txn table (desktop + mobile cards), confirm/fail (admin), **Receipt** button on SUCCESS rows (lazy-loads `receiptPdf.ts`). Add edit-note/void here for piece B.
- `frontend/src/features/loans/components/{DueCyclesTab,CycleStatusChip,LoanStatusChip}.tsx`, `cycleStatusMeta.ts`, `loanStatusMeta.ts`, `paymentMethodLabels.ts`.
- `frontend/src/features/loans/receiptPdf.ts` (`downloadReceiptPdf({txn, loan, summary})`) + `loanStatement.ts` (`printLoanStatement({loan, cycles, transactions, summary})`) — receipt/statement generators, reusable.
- Permission hook pattern: `features/loans/financePermissions.ts` `useFinancePermissions`; auth via `@/app/auth-context` `useAuth()` → `user.role` (`ADMIN | SUPER_ADMIN | EMPLOYEE`). `isAdmin = role==='ADMIN' || 'SUPER_ADMIN'`.
- List page reference for table+search+sort+pagination+mobile-cards+empty-states: `features/loans/pages/LoansListPage.tsx` — **copy its patterns** (debounced URL search, server sort, `EmptyState`, responsive toolbar with CSS `order`).

## 6. Decide first (ask the user)
- **Folder/naming:** new `features/transactions/` vs extending `features/loans/`. (Finance module deliberately kept folder `features/loans/` + `Loan*` component names while user-facing label is "Finances". Mirror that decision for Transactions.)
- **Worklist backend endpoint shape** — confirm the new `/due-cycles` cross-loan filter signature with the user before building; they apply it on EC2.
- **Scope order:** recommend A (worklist) first for operational value, but it has the backend dependency; B (edit/void) is pure FE and quick. Confirm priority.

## 7. Gotchas (carry-forward from Finance module)
- Loan PATCH/POST/approve responses **omit nested includes** (customer/vehicle). `useLoan` fetches `?include=customer,vehicle,created_by,updated_by`, `staleTime:30s`. Loan mutations must `invalidateQueries(loanKeys.detail)` — never `setQueryData` the include-less response.
- Aadhaar/PAN arrive **masked**; never echo back; reveal via audited unmask endpoints (admin/super).
- Multipart upload sets `multipart/form-data` so axios picks the boundary.
- jsPDF statically pulls in html2canvas/dompurify (~165KB gzip) → **lazy-load** any module that imports it (`await import(...)`) so it stays out of the main chunk (see `TransactionsTab.onReceipt`).
- MUI `MuiAlert`/`MuiStepLabel` dark-mode overrides in `styles/mui-theme.ts` pinned to solid tokens.
- Live test data to clean on EC2 (from earlier verify): a confirmed ₹5450 txn on loan `LMS-2026-140147` (cycle #1 PAID_ON_TIME) and orphan customer "ZTEST Guarantor" `9000000077`.

## 8. Quick start (new chat)
```
cd /home/ak/finance-erp-frontend/.claude/worktrees/finance-erp-fe-loans/frontend
export PATH=/home/ak/.nvm/versions/node/v22.17.0/bin:$PATH
node_modules/.bin/tsc -b --noEmit && corepack pnpm build
```
Read first: `src/routes/_authed/transactions.tsx` (the stub), `features/loans/pages/LoansListPage.tsx` (list patterns), `features/loans/components/{TransactionsTab,DueCyclesTab,RecordPaymentDialog}.tsx`, `api/queries/{transactions,dueCycles,loans}.ts`. Backend truth: live `/openapi.json` + worktree `backend/app/{schemas,services,api/v1/routes}/{transaction,due_cycle,report}.py`.
Suggested first task: **B (edit-note/void — pure FE, quick win)** then **A (collections worklist — confirm the new backend endpoint with the user first)**.
```

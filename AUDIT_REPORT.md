# Finance-ERP — Deep Code Audit

_Generated 2026-06-20 · branch `claude/repo-access-check-b2eze4` · read-only review (no code changed)_

Two review passes: (1) a correctness/security sweep, (2) a layer-by-layer deep search
(frontend, backend, database, migrations, storage, jobs/ops). Every high-impact finding
was independently verified by reading the cited code. Findings refuted during verification
are listed at the end so you can see what was vetted and dismissed.

**Stack:** React 19 + Vite + TanStack Query/Router (frontend) · FastAPI + SQLAlchemy 2.0 +
PostgreSQL (backend) · AWS S3/KMS (storage) · APScheduler (jobs).

## Severity legend
- 🔴 **Critical** — data corruption, money error, or PII exposure in normal operation
- 🟠 **High** — wrong behavior / security gap on a reachable path
- 🟡 **Medium** — correctness or hardening gap with conditions
- 🔵 **Low** — cleanup, drift, defense-in-depth

Status: **Confirmed** (verified against code) · **Plausible** (realistic, not fully proven).

---

## 0. Top priorities (fix first)

| # | Finding | Layer | Sev |
|---|---------|-------|-----|
| F1 | Down-payment double-counted → outstanding understated by full DP | Backend / financial | 🔴 |
| S1 | Aadhaar/PAN stored in **plaintext** (encryption is masking-on-read only) | Storage | 🔴 |
| F2 | Late payment allocated to a **future** cycle → unjust penalty on the overdue one | Backend / financial | 🟠 |
| F3 | Business dates use server UTC `date.today()` not IST helper → off-by-one 00:00–05:30 IST | Backend / financial | 🟠 |
| B1 | IDOR — any employee can propose **any** loan into bad-debt | Backend / API | 🔴 |
| B2 | PENDING transactions permanently stuck once loan hits AWAITING_CLOSURE | Backend / financial | 🟠 |
| B3 | ORM transient fields nulled by `db.refresh()` after customer update | Backend / DB | 🟠 |

---

## 1. Security (cross-cutting)

| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| SEC1 | **Plaintext Aadhaar/PAN** — `id_number` is `String(50)`, written cleartext; `pii.py` only masks on read. No app-layer crypto anywhere. | `models/identity_proof.py:47`, `services/identity_proof.py:72` | 🔴 | Confirmed |
| SEC2 | Aadhaar mask leaks last-4 (`********{v[-4:]}`); PAN mask leaks first-2+last-2 → re-identification | `utils/pii.py:14,23` | 🟡 | Confirmed |
| SEC3 | S3 object key embeds customer **real name** + customer-id prefix → leaks identity via any logged presigned URL | `services/document.py:335` | 🟡 | Confirmed |
| SEC4 | JWT decode doesn't `require` `exp` and has no `aud`/`iss` binding → a token minted without expiry passes forever; tokens reusable across envs sharing `SECRET_KEY` | `services/auth.py:92` | 🟡 | Plausible |
| SEC5 | No revocation on password change/reset — stolen JWT valid up to 8h after victim changes password | `services/auth.py:317,367` | 🟡 | Confirmed |
| SEC6 | Deactivated/**locked** user keeps access until token expiry (no `locked_until` recheck; 8h TTL) | `dependencies/auth.py:39`, `config.py:23` | 🟡 | Confirmed |
| SEC7 | `change_password` has no rate limit / lockout → unlimited current-password brute-force with a stolen session token | `services/auth.py:318`, `routes/auth.py:163` | 🟡 | Confirmed |
| SEC8 | In-memory rate limiter is **per-worker** and resets on deploy → real login limit is `10×N`/min, resettable on demand | `core/rate_limit.py:31` | 🟡 | Confirmed |
| SEC9 | CORS `allow_methods=["*"] + allow_headers=["*"] + allow_credentials=True`; origin regex allows unbounded Vercel subdomain suffix | `main.py:88` | 🟡 | Plausible |
| SEC10 | `SECRET_KEY` validated by length ≥32 only (no entropy/placeholder check) | `core/config.py:154` | 🔵 | Confirmed |
| SEC11 | JWT bearer token stored in `localStorage` → XSS-exfiltratable; no httpOnly cookie | `frontend/src/lib/storage.ts:84` | 🟠 | Confirmed |

---

## 2. Frontend

### Auth / routing / access control
| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| FE1 | Admin routes `/team`, `/reports` gated only by **token-presence** layout; role check is render-time, so the page mounts and fires admin queries for employees (relies entirely on backend 403) | `routes/_authed/route.tsx:11`, `team.tsx`, `reports.tsx` | 🟠 | Confirmed |
| FE2 | Hardcoded role strings (`=== 'ADMIN' \|\| 'SUPER_ADMIN'`) duplicated in 4+ places, not driven off `UserRole` enum → silent loss of admin UI if a role is renamed | `nav/navUtils.ts:16`, `team/pages/TeamPage.tsx:67`, `loans/financePermissions.ts:33`, `reports/pages/ReportsPage.tsx:25` | 🟡 | Confirmed |
| FE3 | No token expiry / silent-refresh; `useMe` is `staleTime: Infinity` → UI shows authed past expiry, next mutation 401s and drops in-progress form data | `api/queries/auth.ts:91`, `client.ts:37` | 🟡 | Confirmed |
| FE4 | App-load race: `_authed` renders children before `/me` resolves → role UI flickers, queries fire before identity known | `routes/_authed/route.tsx:11` | 🟡 | Confirmed |
| FE5 | Logout is client-only (no server revoke) — combined with stateless JWT, an exfiltrated token survives logout | `api/queries/auth.ts:96` | 🟡 | Confirmed |
| FE6 | 401 interceptor redirects to bare `/login` (drops `?redirect=`), inconsistent with router guard | `api/client.ts:37` | 🔵 | Confirmed |

### Data / state / money rendering
| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| FE7 | `useClassifyCycle`/`useReclassifyCycle` invalidate only cycle+txn keys, **not** `loanKeys.detail`/`transactionKeys.summary` → loan header & outstanding stale after a penalty-adding classify | `api/queries/dueCycles.ts:156,173` | 🟠 | Confirmed |
| FE8 | `useCloseLoan` invalidates `loanKeys.byCustomer(closure.loan_id)` — passes **loan id** where a **customer id** is expected → customer's loan list keeps showing the closed loan | `api/queries/loans.ts:341` | 🟠 | Confirmed |
| FE9 | `useLoanTransactions` hardcodes `page_size:100`; loans >100 txns silently truncate, and `DueCyclesTab` sums a truncated list for the net-due waterfall | `api/queries/transactions.ts:68` | 🟠 | Confirmed |
| FE10 | Confirm/Fail double-submit window: `acting` re-enables before the invalidated refetch lands → second click hits `/confirm` on an already-SUCCESS txn (409). Member-path POSTs carry no idempotency key | `components/TransactionsTab.tsx:207`, `api/client.ts:22` | 🟡 | Plausible |
| FE11 | Float accumulation: `totalPaid = reduce(sum + Number(t.amount))` with no per-step rounding seeds the whole net-due waterfall → residual `₹0.01`, cycle never reads fully-paid | `components/DueCyclesTab.tsx:130` | 🟡 | Plausible |
| FE12 | UTC `created_at` rendered with local-tz `fmtDate` → "Recorded" date disagrees with audit trail / across timezones | `lib/format.ts:24`, `CollectionsWorklistPage.tsx:666` | 🟡 | Plausible |
| FE13 | FE/BE finance math duplicated with different rounding (`Math.round` half-up vs Python `ROUND_HALF_EVEN`) → quoted EMI can differ from generated schedule | `features/loans/financeMath.ts:42`, `services/finance.py:21` | 🟡 | Confirmed |
| FE14 | `DueCyclesTab` runs O(N) `deriveNetDue` + nested stale-detection (cycles×txns) + map build every render, no `useMemo` → jank | `components/DueCyclesTab.tsx:129-177` | 🔵 | Confirmed |
| FE15 | `EditTransactionDialog` Zod `due_cycle_id: z.string()` (no `.min(1)`) → unallocated txn saved silently; schema drift vs create dialog | `components/EditTransactionDialog.tsx:56` | 🟡 | Confirmed |
| FE16 | `LoanCollectionsPage` deep-link effect deps `[search.action, search.cycleId]` omit `cycles` → dialog opens empty if cycles query hasn't resolved | `pages/LoanCollectionsPage.tsx:120` | 🟡 | Confirmed |
| FE17 | `ChangePasswordDialog` maps every 400 to "current password incorrect" → wrong message for policy violations | `components/ChangePasswordDialog.tsx:100` | 🔵 | Confirmed |

### Reuse / simplification (frontend)
- Three near-identical debounced autocomplete pickers (`CustomerPicker`, `VehiclePicker`, `EmployeePicker`).
- `RecordPaymentDialog` ↔ `EditTransactionDialog` duplicate schema + form body (already drifted on `due_cycle_id`).
- `ResetPasswordDialog` ↔ `CreateAccountDialog` duplicate password+generate block (`ChangePasswordDialog` already extracted a helper).
- 9 dialogs inline the same `DialogActions` responsive `sx` object.
- `TXN_TYPE_LABELS` / `TXN_STATUS_LABELS` defined verbatim in 3 files.

---

## 3. Backend (API + business logic)

### Financial correctness
| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| BF1 | **Down-payment double-counted.** `total_payable = principal + interest` never subtracts DP, schedule uses full principal, yet DP is inserted as a SUCCESS txn counted in `total_paid` → `outstanding` understated by the full DP; loan flips to AWAITING_CLOSURE early | `services/transaction.py:214`, `services/loan.py:462`, `services/finance.py:26`, `services/due_cycle.py:66` | 🔴 | Confirmed |
| BF2 | Payment allocation picks earliest cycle with `due_date >= payment_date`, ignoring unpaid/overdue status → a normal late payment skips the overdue cycle (which then gets penalized) and credits a future cycle | `services/due_cycle.py:135` | 🟠 | Confirmed |
| BF3 | Business dates use `date.today()` / UTC despite `utils/time.today_in_tz('Asia/Kolkata')` existing → off-by-one for days-late / overdue / due-date between 00:00–05:30 IST | `services/loan.py:292,450`, `services/due_cycle.py:71`, `services/transaction.py:416` vs `utils/time.py:20` | 🟠 | Confirmed |
| BF4 | PENDING transactions become unconfirmable once the first confirm moves the loan to AWAITING_CLOSURE (status guard rejects them) → legitimate payments stuck | `services/transaction.py:506` | 🟠 | Confirmed |
| BF5 | Cumulative penalty per cycle isn't capped at 100% of the original late amount — re-classifications stack onto `penalty_amount` past the single-event cap | `services/penalty.py:93,129` | 🟡 | Plausible |
| BF6 | `cap_hit = penalty >= shortfall` auto-proposes bad debt on the *first* full-month-late classify (penalty clamps to shortfall, making `==` common) → over-aggressive | `services/penalty.py:93,158` | 🟡 | Plausible |
| BF7 | Penalty divisor uses the **due month's** day count regardless of months late → same delay yields different penalty depending on which month the EMI fell in | `services/finance.py:86`, `services/penalty.py:144` | 🟡 | Plausible |
| BF8 | Reclassify→PAID_ON_TIME zeroes a cycle's penalty/add-ons that may have **already been collected** on later cycles → loan appears overpaid with no record justifying the credit | `services/penalty.py:255,351` | 🟡 | Plausible |
| BF9 | `SUPER_ADMIN` can PATCH `down_payment`/`penalty_rate` to `null` (schema `Optional`) → later `enrich_loan` / `daily_penalty` crash with `TypeError` | `routes/loans.py:77`, `services/penalty.py:89` | 🟡 | Plausible |

### API / auth surface
| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| BA1 | **IDOR** — `POST /loans/{id}/bad-debt/propose` uses `get_current_user`, not `require_admin`/`_assert_loan_access`; any employee can propose any loan | `routes/bad_debt.py:34` | 🔴 | Confirmed |
| BA2 | `update_customer` sets join-derived fields (`assigned_employee_name`, `primary_loan_number`, `primary_vehicle_number`) as transient ORM attrs, then calls `db.refresh()` → every PATCH response returns them as `null` | `services/customer.py:135,356` | 🟠 | Confirmed |
| BA3 | WRITE_OFF closure asserts `amount_written_off == outstanding` exactly; a payment confirmed between FE summary fetch and close → 400, closure fails | `components/CloseLoanAction.tsx:274`, `services/loan_closure.py:101` | 🟠 | Confirmed |
| BA4 | Idempotency duplicate-key detected via `"idempotency_key" in str(e.orig)` → breaks under non-English PG `lc_messages`, returns 400 instead of replaying | `services/transaction.py:468` | 🟡 | Confirmed |
| BA5 | Overpayment create-time gate subtracts `total_pending`, but confirm-time gate only logs a warning and proceeds → multiple PENDING can over-collect past outstanding | `services/transaction.py:406,515` | 🟡 | Plausible |

### Reuse / altitude (backend)
- `TransactionResponse` lacks resolved cycle metadata → frontend re-joins cycles client-side (`TransactionsTab`).
- `IntegrityError` handled by string-matching raw driver text rather than `e.orig.diag.constraint_name`.
- Default penalty rate (36%) and cap (1000%) duplicated across ORM default, migration, schema, and FE form.
- `IdentityProofListResponse`/`StabilityDocumentListResponse`/`DocumentListResponse` re-declare pagination shape; no shared `PaginatedResponse[T]`.
- `list_all` for identity proofs & stability docs fakes pagination (`page_size=len(results)`, no LIMIT/OFFSET).

---

## 4. Database

### Models / constraints
| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| DB1 | `updated_at` has `server_default` but no `onupdate` and no trigger anywhere → never advances on row mutation; breaks "recently modified" reports, optimistic concurrency, ETL | `models/base.py:46` (+ hand-rolled blocks in `due_cycle`, `loan_closure`, `bad_debt_proposal`) | 🟡 | Confirmed |
| DB2 | `Customer.mobile_number` is indexed but **not unique** → duplicate customer records for the same person, split loans, understated outstanding | `models/customer.py:25` | 🟡 | Confirmed |
| DB3 | `Personnel.mobile_number` / `Vehicle.chassis_number` use **non-partial** unique → a soft-deleted row permanently blocks re-creating that person/VIN | `models/personnel.py:25`, `models/vehicle.py:45` | 🟡 | Confirmed |
| DB4 | `Vehicle.plate_number` not unique at all (only the migration's partial index enforces it) → duplicate active vehicles can share a plate in a model-built schema | `models/vehicle.py:37` | 🟡 | Confirmed |
| DB5 | No composite index on `(loan_id, status)` / `(due_cycle_id, status)` — the hot allocation/penalty/recompute paths filter exactly on these | `models/transaction.py:66` | 🟡 | Confirmed |
| DB6 | No DB CHECK enforcing `status <> 'ACTIVE' OR principal IS NOT NULL` → an ACTIVE loan with NULL principal/tenure (any non-`approve_loan` write path) breaks schedule/EMI math | `models/loan.py:63` | 🟡 | Confirmed |
| DB7 | `loan_closure` money fields (`amount_written_off`, etc.) have no `>= 0` CHECK → negative write-off corrupts loss provisioning | `models/loan_closure.py:94` | 🔵 | Confirmed |

### Migration ↔ ORM drift (mostly bites tests / fresh `create_all`, not prod)
| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| DB8 | `Transaction.idempotency_key` model says **global** `unique=True`; migration 005 replaced it with a **per-loan** partial unique. A model-built schema re-introduces the cross-loan leak migration 005 fixed | `models/transaction.py:95` vs `migrations/005_audit_fixes.sql:19` | 🟡 | Confirmed |
| DB9 | `stability_documents.cheque_count` model CHECK (`>= 0`) contradicts migration 009's conditional CHECK (NULL unless CHEQUE_PDC, else `>= 1`) — comment claims "no ORM drift" but there is | `models/stability_document.py:29` vs `migrations/009:78` | 🟡 | Confirmed |
| DB10 | Several `loans` CHECKs (down_payment/fee/penalty_rate/due_day ≥0, ≤1000) exist in SQL but not in the ORM → tests pass invalid values prod rejects | `migrations/001,004` vs `models/loan.py` | 🔵 | Confirmed |
| DB11 | `Customer.idempotency_key` model omits unique, but migration 003 has the partial unique index (so prod is safe — pure drift) | `models/customer.py:48` vs `migrations/003:66` | 🔵 | Confirmed |
| DB12 | `schema_migrations` backfill (010) omits its **own** row → `migrate.py status` permanently mislabels 010 as pending when applied by hand | `migrations/010:38` | 🔵 | Confirmed |
| DB13 | Migration 001 PART B is not idempotent (no `IF [NOT] EXISTS` on ADD COLUMN / DROP TRIGGER) → can't cleanly replay on DR/new-env rebuild | `migrations/001` | 🔵 | Confirmed |

---

## 5. Storage (S3 / documents / PII)

| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| ST1 | **Antivirus is a no-op** (`AKTODO` placeholder); uploads are stored and made downloadable unscanned; no `scan_status` column exists | `routes/documents.py:144`, `services/document.py:362,481` | 🟠 | Confirmed |
| ST2 | Download URL issued with no scan gate (`# AKTODO: refuse if scan_status != CLEAN` is just a comment) | `services/document.py:480` | 🟠 | Confirmed |
| ST3 | MIME decided from first **2048 bytes** only → polyglot / appended-payload bypass; stored `content_type` trusts the 2KB head | `routes/documents.py:137` | 🟡 | Confirmed |
| ST4 | Soft-delete archive is non-atomic: S3 copy+delete runs before `db.commit()`; a crash in the gap leaves `is_deleted=false` pointing at a moved/missing key. Recovery depends on an unimplemented janitor | `services/document.py:546`, `utils/s3.py:124` | 🟡 | Confirmed |
| ST5 | `update_document_metadata` renames `file_name` in DB but never renames the S3 object/`s3_key` → permanent metadata/object divergence | `services/document.py:449` | 🔵 | Confirmed |
| ST6 | KMS not required — `put_object` silently downgrades to SSE-S3 (AWS-managed keys) if `KMS_KEY_ID` unset; consider fail-closed for compliance | `utils/s3.py:67` | 🔵 | Confirmed |

_(Plaintext PII and S3-key name leak are listed under Security: SEC1, SEC3.)_

---

## 6. Jobs / scheduler / ops

| # | Finding | File | Sev | Status |
|---|---------|------|-----|--------|
| OP1 | 30/60-day late milestone uses `days_late == 30/60` (exact) → if the nightly job misses that exact day, the alert is lost forever (collections never notified) | `jobs/nightly_cycle_check.py:192,201` | 🟠 | Confirmed |
| OP2 | Cap auto-classify passes `classified_as_of_date=today` instead of the documented `due_date + cap_days` → penalty amount depends on job uptime (non-deterministic; NBFC compliance issue) | `jobs/nightly_cycle_check.py:227` vs docstring | 🟡 | Confirmed |
| OP3 | Audit rows share the action's transaction (SAVEPOINT). A later per-loan error rolls back the whole loan **including already-written milestone/audit rows** → compliance milestone silently lost | `utils/audit.py:79`, `jobs/nightly_cycle_check.py:287,291` | 🟡 | Confirmed |
| OP4 | Audit write failures swallowed with only `type(exc).__name__` (no `exc_info`/message) → unloggable audit gaps; a PII_UNMASK can drop its audit row and still return 200 | `utils/audit.py:81` | 🟡 | Confirmed |
| OP5 | `migrate.py apply` has no inter-process lock around read-decide-apply → concurrent deploy pods both run the same non-idempotent migration body twice | `migrate.py:254` | 🟡 | Confirmed |
| OP6 | `_apply_one` trusts files to self-COMMIT; a file that COMMITs then errors leaves schema changed but tracker row absent → next run re-applies and wedges the deploy | `migrate.py:226` | 🟡 | Confirmed |
| OP7 | N+1 in nightly job: per-loan cycle query + per-cycle `_has_active_event` penalty lookup → ~100k single-row queries at 5k loans | `jobs/nightly_cycle_check.py:262`, `services/penalty.py:201` | 🟡 | Confirmed |
| OP8 | Per-replica APScheduler + short-lived lock + 15-min misfire grace → a slow run that frees the lock can let a clock-skewed replica re-fire the same night (double-process risk) | `core/scheduler.py:101` | 🔵 | Plausible |
| OP9 | Sync S3 boto3 calls in sync upload/download/delete routes block Starlette's thread pool under concurrent uploads | `routes/documents.py:103`, `utils/s3.py:53` | 🔵 | Confirmed |

---

## Checked — NOT defects (vetted and dismissed)

- **Customer idempotency race** → migration 003 has a partial unique index; service catches `IntegrityError` and returns the existing row. Safe (pure ORM drift, DB11).
- **Advisory-lock leak halting the nightly job** → the session holds one pooled connection for its lifetime; `db.commit()` doesn't swap it, so unlock runs on the acquiring backend.
- **Pagination `page=0` → negative OFFSET / 500** → every list route enforces `Query(1, ge=1)`; FastAPI 422s first.
- **Overpayment double-subtraction of `total_pending`** → `outstanding` is computed from SUCCESS-only `total_paid`, so subtracting pending once is correct.
- **`confirm_transaction` missing `is_deleted` filter** → unreachable via the route (txn fetch already filters deleted; a deleted loan isn't ACTIVE).
- **SQL injection / hardcoded secrets / JWT alg-confusion / PII-in-logs** → ORM is parameterized, the one `text()` uses a bound param, `algorithms=[...]` is a whitelist, error envelope and log formatter redact. Clean.
- **bcrypt 72-byte truncation, timing-equalized unknown-user path, spoof-resistant XFF** → correctly handled.

---

## Suggested remediation order

1. **SEC1 plaintext PII** — encrypt `id_number` at rest (envelope/KMS or `EncryptedType`); highest regulatory + breach risk.
2. **BF1 down-payment math** — decide whether DP reduces financed principal or adds to `total_payable`, fix in one place, add a test asserting FE/BE agree.
3. **BA1 bad-debt IDOR** — add `require_admin` + `_assert_loan_access` (one-line gate).
4. **BF2 / BF3 / BF4** — payment allocation, IST date helper adoption, and AWAITING_CLOSURE confirm path; all change customer-facing money/penalties.
5. **ST1/ST2 antivirus** — add `scan_status` column + gate downloads; quarantine on upload.
6. **BA2 ORM-refresh nulling** — move join-derived fields into a response DTO (also fixes the `db.refresh()` data loss).
7. Frontend cache-invalidation set (FE7/FE8) and the security hardening batch (SEC4–SEC11).

_No files were modified by this audit._

# Backend Code Audit — Finance / Loan-Management ERP

**Reviewer:** Senior Backend Engineer / Architect (autonomous pass)
**Date:** 2026-06-20
**Scope:** `backend/` only (FastAPI service). Frontend out of scope.

---

## 1. Executive Summary

### Detected stack (inferred)

| Layer | Detected |
|---|---|
| Language / runtime | Python 3.11+ (uses `zoneinfo`, PEP 604 unions, `Mapped[...]`) |
| Web framework | FastAPI 0.136 + Starlette, Uvicorn |
| ORM / DB | SQLAlchemy 2.0 (Declarative `Mapped`), PostgreSQL via psycopg2; asyncpg present but the request path is sync |
| Auth | OAuth2 password flow, JWT (python-jose, HS256), bcrypt via passlib |
| Background work | APScheduler in-process nightly job, Postgres advisory lock for single-fire |
| Storage | AWS S3 (boto3) with SSE (KMS/AES256), presigned download URLs |
| Rate limiting | slowapi (IP-keyed) |
| Migrations | Hand-rolled numbered SQL runner (`migrate.py`) with a `schema_migrations` tracker |
| Domain | NBFC-style vehicle/hire-purchase loan management: customers, loans, due-cycles, penalties, bad-debt, closures, documents, reports |

### Architecture

A clean **modular monolith** with disciplined layering: `routes → services → models`, shared `utils`, cross-cutting `core` (config, db, error envelope, logging, rate-limit, scheduler). Routes never contain business logic; services never import routes; cross-domain calls go through thin facades. This is **above-average engineering** for a system of this size (~17k LOC).

### Top takeaways

1. **This is a mature, security-conscious codebase.** PII masking + audited unmask, a single redacting error envelope, trusted-proxy IP resolution, magic-byte upload validation, server-side-decided roles, row locks on money paths, partial unique indexes, idempotency keys, and a drift-aware migration runner are all present and correct. Most "findings" below are sharp edges, not broken windows.
2. **Open public self-registration (`/auth/register`) is the most material risk** — anyone on the internet can mint an `EMPLOYEE` account on a financial system. (High)
3. **`date.today()` is used in the financial/penalty paths despite a purpose-built `today_in_tz()` helper and an explicit warning against it.** The nightly penalty/bad-debt job is the worst case: it runs at 02:00 IST, where `date.today()` (UTC) is *the previous calendar day*. (High → Medium)
4. **Loan approval lacks the row lock** that every other state-transition path (`confirm`, `close`, `propose`) correctly takes — saved from corruption only by a unique index, at the cost of a 500 on the loser. (Medium)
5. Operational hardening gaps for horizontal scaling: in-process rate-limit counters and no DB statement timeout. (Medium/Low)

### Severity counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 5 |
| Nitpick | 3 |

---

## 2. What's Done Well (keep this)

- **Single audit choke point** (`utils/audit.write_audit`) writing through a `SAVEPOINT` so audit failures never poison the caller's transaction, with PII kept out of payloads (presence-flags only). Compliance-grade.
- **One global error envelope** (`core/error_handlers.py`) that redacts SQL/driver/stack details from the wire and logs them server-side — a 500 never leaks schema or bound params.
- **Trusted-proxy-aware client IP** (`utils/client_ip.py`) shared by *both* the audit log and the rate limiter, with a correct fail-closed rule for short/forged `X-Forwarded-For` (avoids the classic `max(0, len-hops)` bug). The reasoning is documented and right.
- **Security-by-default on roles**: `role` is never a request field; it's decided by which endpoint was hit (`schemas/user.py` comment + `services/auth.create_user`). `SUPER_ADMIN` cannot be created or assigned via the API.
- **PII handling**: Aadhaar/PAN masked at the response schema; unmask is a dedicated, audited, `no-store` endpoint with per-role + per-assignment checks.
- **Upload validation**: extension allowlist → bounded spooled read (OOM-safe) → **magic-byte** MIME sniff (not client `Content-Type`) → forced `attachment` disposition on presigned download (XSS hardening) → SSE at rest. Genuinely thorough.
- **Money-path concurrency**: `with_for_update` on the loan row in `create_transaction`, `confirm_transaction`, and `close_loan`; cycle rows locked during recompute.
- **Soft-delete invariants** enforced by `CHECK` constraints + centralized `soft_delete()/restore()` helpers; partial unique indexes (`WHERE is_deleted = false`) so deletes don't block re-creation.
- **Timezone-correct reporting** (`services/report.py`): `AT TIME ZONE` casts and IST-midnight→UTC conversion so late-night IST rows bucket correctly. (Which is exactly why its absence elsewhere stands out.)
- **Migration runner** with duplicate-version detection, fresh-DB bootstrap guard, legacy-DB detection, and SHA-256 drift warnings.
- **Injection-safe** throughout: ORM with bound parameters everywhere; `ILIKE` search escapes `%`/`_`/`\`. No raw string-built SQL found.
- **Penalty engine correctness**: replay-from-scratch on reclassification (`recompute_addons_for_loan`) to avoid rounding drift, with banker's rounding and last-cycle remainder absorption.

---

## 3. Findings by Category

### Security

#### [High] Open public self-registration mints EMPLOYEE accounts
- **Location:** `app/api/v1/routes/auth.py:868-899` (`register`); policy doc at `auth.py:813-814`.
- **Issue:** `POST /api/v1/auth/register` is public and unconditionally creates an `EMPLOYEE`. The route's own docstring describes an intended gate ("only when zero users exist OR …") that is **not implemented** — there is no bootstrap check. On an NBFC system, any anonymous internet user can create a valid authenticated principal. A self-registered employee can then create customers (with PII), create loans, upload documents, and record transactions for customers they assign to themselves. This is a real expansion of the attack surface and a likely compliance problem (unauthorized access to a regulated lending platform). Rate limiting (`3/minute`) slows but does not prevent it.
- **Recommendation:** Gate registration. The cleanest options, in order of preference:
  1. **Remove public registration** entirely and create all users through the admin-authenticated endpoints (`/auth/employee`, `/auth/admin`). The first SUPER_ADMIN is seeded via migration/CLI.
  2. Keep `/register` but **only when the users table is empty** (first-run bootstrap), then 403 thereafter:
     ```python
     from app.models.user import User
     if db.query(User.id).limit(1).first() is not None:
         raise HTTPException(status.HTTP_403_FORBIDDEN,
                             "Self-registration is disabled. Contact an administrator.")
     ```
  3. Put it behind an env flag (`SELF_REGISTRATION_ENABLED=false` by default).
- **Effort:** quick win.
- **Assumption:** This is a private, staff-only back-office system (no customer self-service signup). If public signup is genuinely intended, the risk is lower but the bootstrap-gate intent in the docstring still indicates the current behavior is unintended.

#### [Medium] In-process rate-limit counters weaken under multiple workers
- **Location:** `app/core/rate_limit.py` (slowapi `Limiter` with default in-memory storage).
- **Issue:** slowapi's default storage is per-process. With `uvicorn --workers N` (or multiple pods), each worker keeps its own counter, so the effective limit is `N ×` the configured value and brute-force/PII-enumeration protection degrades proportionally. The DB-backed login lockout (`authenticate_user`) is a solid backstop for credential stuffing, but the lookup/upload/register limits have no such backstop.
- **Recommendation:** Point slowapi at a shared store (Redis) in any multi-worker deployment: `Limiter(key_func=_client_ip_key, storage_uri=settings.REDIS_URL)`. If Redis isn't on the roadmap, document that the service must run single-worker, or move the limits to the ALB/WAF.
- **Effort:** moderate (introduces a Redis dependency).

#### [Medium] JWT has no revocation; password change doesn't invalidate other sessions
- **Location:** `app/services/auth.py:537-586` (`change_password`), `:592-629` (`admin_reset_password`); decode at `:324`.
- **Issue:** Tokens are stateless with an 8-hour TTL and no `jti`/token-version. After a password change or admin reset, **already-issued tokens stay valid for up to 8 hours**. The caveat is documented, but for a financial system a leaked/compromised token surviving a credential reset is a meaningful gap. *(Note the positives: role changes are effective immediately because `get_current_user` reads `user.role` from the DB each request, and deactivation/soft-delete is immediate because `get_user_by_id` filters `is_active`/`is_deleted`. The only real gap is password-change session invalidation.)*
- **Recommendation:** Add a `token_version` (int) column on `users`, embed it in the JWT, and compare in `get_current_user`; bump it on password change/reset. This revokes all sessions on credential change without a full token store.
- **Effort:** moderate.

#### [Low] Timing side-channel distinguishes locked/inactive accounts
- **Location:** `app/services/auth.py:646-768` (`authenticate_user`).
- **Issue:** The unknown-user branch runs `verify_password` against `_DUMMY_HASH` to equalize timing (good). But the `inactive_or_deleted` and `locked` branches return **before** any bcrypt verification, so those accounts respond measurably faster than a valid-but-wrong-password attempt. This is a weak oracle for "this username exists and is locked/disabled."
- **Recommendation:** Run a dummy `verify_password` on the locked/inactive branches too (or restructure so bcrypt cost is paid on every path). Minor; the generic 401 mapping already blunts most enumeration.
- **Effort:** quick win.

#### [Low] CORS preview-deployment regex is broad
- **Location:** `app/main.py` (`allow_origin_regex` for `*.vercel.app`) with `allow_credentials=True`.
- **Issue:** The regex admits any suffix on those Vercel project names (`-[a-z0-9-]+`) as a credentialed origin. The blast radius is limited to whoever controls those Vercel projects, but credentialed CORS to auto-generated preview URLs is a wider trust boundary than necessary.
- **Recommendation:** Restrict previews to known patterns, or drop credentialed CORS for preview hosts and only allow the production origin(s) via the explicit `CORS_ORIGINS` env list. The hard-fail-on-wildcard validator is excellent — extend that rigor to the regex.
- **Effort:** quick win.

### Concurrency & Data Integrity

#### [Medium] Loan approval is not row-locked (TOCTOU on DRAFT → ACTIVE)
- **Location:** `app/api/v1/routes/loans.py:137-168` and `app/services/loan.py:409-502` (`approve_loan`). Contrast with `confirm_transaction` / `close_loan`, which take `with_for_update`.
- **Issue:** `get_loan()` reads the loan without a lock; `approve_loan` re-checks `status == DRAFT` but still without a lock, then generates cycles + a DOWN_PAYMENT transaction. Two concurrent approvals can both observe `DRAFT` and both proceed. The partial unique index `uq_due_cycles_loan_cycle_active (loan_id, cycle_number) WHERE is_deleted=false` (migration 004) prevents the worst outcome (duplicate schedules), so **data stays consistent** — but the losing request hits an unhandled `IntegrityError` that surfaces as a generic **500**, and a second `DOWN_PAYMENT` row can be created in the losing transaction before the cycle insert fails and rolls back.
- **Recommendation:** Lock the loan in the approve path exactly like close does, and translate the duplicate into a clean domain error:
  ```python
  loan = (db.query(Loan)
            .filter(Loan.id == loan_id, Loan.is_deleted.is_(False))
            .with_for_update().first())
  ...
  # in approve_loan, wrap the commit:
  try:
      db.commit()
  except IntegrityError:
      db.rollback()
      raise ValueError("Loan is already being approved or has been approved")
  ```
- **Effort:** quick win.

### Correctness — Time / Business Date

#### [High] Nightly penalty/bad-debt job computes "today" in UTC, not business time
- **Location:** `app/jobs/nightly_cycle_check.py:250` (`today = date.today()`), consumed by `process_loan` for `days_late`, the exact-day milestone match, and the cap auto-classification.
- **Issue:** The scheduler fires at **02:00 in `REPORTS_TIMEZONE` (Asia/Kolkata)** (`core/scheduler.py`, `CronTrigger(hour=NIGHTLY_JOB_HOUR)` with `timezone=REPORTS_TIMEZONE`). At 02:00 IST the server's UTC clock reads ~20:30 of the **previous day**, so `date.today()` returns **yesterday's** calendar date. Everything downstream is then off by one day:
  - `days_late = today - cycle.due_date` is undercounted by 1.
  - The milestone alerts fire on `days_late == 30/60` exactly — they trip one IST-day late.
  - The cap auto-classify (`days_late >= cap_days`) that drives **automatic bad-debt proposal** triggers one day late.
  - It's also internally inconsistent: `_has_milestone_for_today` correctly builds the dedup window in `REPORTS_TIMEZONE` from this UTC-derived `today`, mixing two notions of "today."
  This is a financial-correctness issue in the penalty engine, made more surprising because the codebase *already has* the right tool and uses it correctly in reports.
- **Recommendation:** Use the business-timezone helper:
  ```python
  from app.utils.time import today_in_tz
  from app.core.config import settings
  today = today_in_tz(settings.REPORTS_TIMEZONE)
  ```
- **Effort:** quick win.

#### [Medium] `date.today()` used on other business-date paths (IST midnight mis-bucketing)
- **Location:** `app/services/loan.py:292` (`emi_due_status_map`), `loan.py:450` (`approve_loan` → `approval_date`/`due_day_of_month`), `app/services/due_cycle.py:71` (UPCOMING vs AWAITING_REVIEW seed), `app/services/transaction.py:416` (`eff_date` default), `app/services/loan_closure.py:127` (`closure_date` default).
- **Issue:** Same root cause as the High above, lower blast radius. For requests served between 00:00 and 05:30 IST, `date.today()` (UTC) is still the previous day, so:
  - A loan approved at 01:00 IST gets `approval_date`/`due_day_of_month` for the wrong day, shifting **every** generated due date.
  - A payment with no explicit `effective_payment_date` is stamped a day early.
  - `emi_due_status` (DUE/OVERDUE badge) flips a day early near midnight.
  `utils/time.py` documents this exact hazard ("rolls over at 05:30 IST and gives the wrong day").
- **Recommendation:** Replace each with `today_in_tz(settings.REPORTS_TIMEZONE)`. Consider a lightweight lint/grep guard in CI (`grep -rn 'date.today()' app/` → fail) to prevent regressions, since the helper already exists.
- **Effort:** quick win (mechanical), but touch each call site deliberately — a couple feed persisted columns.

### Error Handling & Resilience

#### [Low] No DB statement/lock timeouts; report queries can pin connections
- **Location:** `app/core/db.py` (engine config); large aggregations in `services/report.py`.
- **Issue:** The pool is well-configured (`pool_pre_ping`, `pool_recycle`, sized overflow), but there's no `statement_timeout` or lock timeout. A heavy customer-report aggregation or a row-lock contention spike on a large tenant can hold a pooled connection indefinitely, starving the pool under load.
- **Recommendation:** Set a server-side guard at connect time:
  ```python
  engine = create_engine(settings.DATABASE_URL, ...,
      connect_args={"options": "-c statement_timeout=30000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000"})
  ```
  Tune per endpoint class (reports may want a longer ceiling than mutations).
- **Effort:** quick win.

#### [Low] Deprecated `@app.on_event` startup/shutdown hooks
- **Location:** `app/main.py` (`@app.on_event("startup"/"shutdown")`).
- **Issue:** Starlette/FastAPI deprecate `on_event` in favor of the `lifespan` context manager. Functionally fine today; will warn and eventually break on upgrade.
- **Recommendation:** Migrate to a `lifespan=` async context manager that starts/stops the scheduler.
- **Effort:** quick win.

### Code Quality & Maintainability

#### [Low] `loan_number` collisions surface as a misleading 409
- **Location:** `app/services/loan.py:155-158` (`generate_loan_number` = `LMS-{year}-{6 digits of a uuid4}`), `:400-406` (create catches `IntegrityError` → generic duplicate message).
- **Issue:** Six decimal digits ≈ 1e6 space; collisions are rare but non-zero and grow with volume. On collision the user sees a duplicate-record 409 for a value they never supplied, with no retry. (`hp_number` is the user-facing id, so impact is low.)
- **Recommendation:** Use a DB sequence / `gen_random_uuid()`-derived suffix, or retry-on-collision with a fresh number a few times before surfacing an error. At minimum, distinguish a system-generated-id collision (500/retry) from a user-supplied uniqueness conflict (409).
- **Effort:** quick win.

#### [Nitpick] Mixed `is_deleted == False` vs `.is_(False)` idioms
- **Location:** throughout; e.g. `services/transaction.py` uses `.is_(False)`, most others use `== False  # noqa: E712`.
- **Issue:** Already acknowledged and governed by `CODESTYLE.md` (per-file consistency is allowed). Purely cosmetic; calling it out only so it's a conscious choice, not drift. Consider a `ruff` E712 rule if you ever want one canonical form.
- **Effort:** n/a (style).

#### [Nitpick] Stray TODO/typo markers in shipped code
- **Location:** `services/transaction.py:76` (`##AKTODO: Make this a resuable util later`), several `AKTODO` markers in `services/document.py` (AV scan, scan_status) and `routes/documents.py`.
- **Issue:** The antivirus-scan TODOs are worth tracking as real backlog (uploads are persisted and served without malware scanning — acceptable for MVP, but it's a known gap with a security dimension). The "resuable util" duplication of the employee-scope join also recurs in `report.py`/`document.py`.
- **Recommendation:** Convert AV-scan TODOs into tracked issues; extract the `EMPLOYEE → assigned customers` join filter into one shared helper.
- **Effort:** moderate (AV pipeline), quick win (the join helper).

#### [Nitpick] Token/login response not marked `no-store`
- **Location:** `app/api/v1/routes/auth.py:905-947` (`login`).
- **Issue:** The unmask PII route correctly uses the `no_store` dependency; the token response (which carries a bearer credential) does not. JSON API responses are not normally cached by browsers, so risk is low, but a misbehaving intermediary could.
- **Recommendation:** Add `dependencies=[Depends(no_store)]` to `login` (and arguably `/me`) for defense-in-depth.
- **Effort:** quick win.

### Observability (note, not a finding)

Structured-ish logging with a sane formatter, third-party loggers tamed, `/health` (shallow) vs `/readyz` (deep, with a bounded 2s S3 probe client) is a textbook split. The main gap is **no metrics/tracing** and plain-text (not JSON) logs — fine for MVP, but plan for structured JSON logs + request IDs before scale. Not scored.

---

## 4. Prioritized Action Roadmap

### Quick Wins (do first — high value, low effort)
1. **Gate `/auth/register`** (first-run-only or remove). *(High, security)*
2. **Nightly job `date.today()` → `today_in_tz(...)`.** *(High, correctness)*
3. **Replace the remaining `date.today()`** call sites with `today_in_tz(...)`; add a CI grep guard. *(Medium, correctness)*
4. **Row-lock `approve_loan`** + translate the duplicate `IntegrityError` to a clean 409. *(Medium, integrity)*
5. Add `statement_timeout`/`lock_timeout` to the engine. *(Low, resilience)*
6. `no-store` on `login`; dummy bcrypt on locked/inactive login branches. *(Low, security)*

### High-Impact (plan into the next iteration)
7. **Shared rate-limit store (Redis)** for multi-worker correctness, or pin single-worker + document. *(Medium)*
8. **JWT `token_version`** to revoke sessions on password change/reset. *(Medium)*
9. **Antivirus scanning** for uploads (the `scan_status` field and TODOs are already stubbed for it). *(Medium, security)*

### Longer-Term Improvements
10. Migrate `on_event` → `lifespan`; when you add a 2nd worker/pod, move the nightly job to an external CronJob (the job already exposes `run_once()` as a CLI entry point — designed for exactly this).
11. Structured JSON logging + request IDs + basic metrics/tracing before scale.
12. Replace `loan_number` generation with a sequence; extract the employee-scope query helper to kill the duplicated join.

---

## 5. Assumptions Made

1. **Deployment posture:** A public-facing, authenticated REST API for a single NBFC tenant, fronted (in prod) by an ALB/reverse proxy — inferred from `TRUST_FORWARDED_FOR`, `/readyz`, k8s-probe comments, and Vercel CORS origins. Severity of the rate-limit and approval-lock findings assumes **more than one worker/replica in production**; if you run strictly single-worker, demote #4's UX impact and #7 to Low.
2. **Audience:** A staff-only back-office system (no customer self-service). This drives the High rating on open registration. If public customer signup is a real product requirement, re-scope that finding.
3. **Business timezone:** `Asia/Kolkata` is the operational timezone and the server clock is UTC (standard for cloud hosts). The date findings hinge on this; if servers run on IST local time the impact shrinks but the latent bug remains.
4. **Penalty/bad-debt is financially material:** I treated incorrect `days_late`/cap timing as High-ish correctness because it drives automatic bad-debt proposals and penalty amounts. If the nightly milestones are advisory-only and an admin always reviews before write-off, the *milestone* portion is lower severity (the penalty-amount and approval-date portions are not).
5. **No hidden test suite / CI gates:** I found `scripts/validate_lifecycle.py` and `scripts/reports_integration_check.py` (smoke/integration scripts) but no `pytest` suite or CI config in `backend/`. I assumed backend test coverage of the penalty/closure state machine is thin; if a suite exists elsewhere, weight the "add tests" implicit recommendation accordingly. **Recommendation regardless:** the penalty reclassification, closure-type math, and cycle-allocation logic are the highest-value targets for unit tests.
6. **Threat model for CORS:** I assumed the named Vercel projects are owned by your org and not registrable by attackers; that's what keeps the regex finding at Low.

---

*End of audit.*

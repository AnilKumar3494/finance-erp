# FinERP — repo orientation

Start here. This is a **monorepo** for a Finance/ERP system for an Indian NBFC
(vehicle finance / hire-purchase loans). Two apps live side by side, both
tracked in git:

```
finance-erp/
├── backend/     FastAPI modular monolith (Python, SQLAlchemy 2.0, Postgres)
└── frontend/    Vite + React 19 + TypeScript (MUI v9, TanStack Router/Query/Table)
```

Git remote: `git@github.com:AnilKumar3494/finance-erp.git`.
Default branch for PRs: **`develop`** (the repo squash-merges — rebase stacked
branches after a merge).

## Read these first (detailed, authoritative)

- **`frontend/AGENT_CONTEXT.md`** — the frontend bible: stack, directory
  layout, architecture rules (design tokens, primitive wrappers, no TanStack
  leakage), code patterns (RQ queries/mutations, RHF+Zod forms, file-based
  routing), the design system, conventions, gotchas, and a
  build-a-new-module recipe. Read it before touching anything under
  `frontend/`.
- **`backend/CODESTYLE.md`** — backend conventions not caught by the
  formatter: SQLAlchemy `is_deleted == False` idiom, import rules (routes
  import services, services never import routes; cross-domain calls go through
  thin facades).

## Frontend quick reference

- **Location**: `frontend/` — `cd frontend` before running scripts.
- **Package manager**: pnpm 10, Node 22. If `pnpm: node: not found`, run
  `nvm use 22` first.
- **Dev server**: `pnpm dev` → **http://localhost:5173** (strict port; kill a
  stray vite rather than switching ports).
- **Scripts**: `pnpm typecheck` (`tsc -b --noEmit`), `pnpm lint`,
  `pnpm build`, `pnpm gen:api` (regenerates `src/api/generated.ts` from the
  live backend `/openapi.json`).
- **Key dirs**: `src/api/queries/<module>.ts` (RQ hooks), `src/features/<module>/`
  (pages + components), `src/routes/_authed/` (auth-guarded routes),
  `src/components/primitives/` (thin MUI wrappers — app code uses `<Btn>`,
  `<Input>`, `<Card>`, not raw MUI), `src/styles/tokens.css` (the only place
  hex colors are allowed).
- After adding/moving/deleting route files, `routeTree.gen.ts` regenerates on
  `pnpm dev` — boot vite briefly before typechecking if it's stale.

## Backend quick reference

- **Location**: `backend/` — FastAPI app under `backend/app/` (`api/v1/`,
  `models/`, `schemas/`, `services/`, `core/`, `jobs/`). Entry: `main.py`.
- **API base**: `/api/v1`. Error envelope is `{ error: { type, message, code,
  fields? } }` (see `app/core/error_handlers.py`), NOT `{ detail }`.
- **Migrations**: numbered SQL files in `backend/migrations/`
  (e.g. `019_loan_dsc_rto_fees.sql`), applied by `backend/migrate.py`. Add a
  new numbered file per schema change; never edit an already-applied one.
- **The backend is the source of truth for the frontend.** Frontend enums
  (`src/schemas/enums.ts`) mirror `backend/app/models/`; API types mirror
  `backend/app/schemas/`. Verify against these files or `/openapi.json` —
  don't invent shapes.

## Deploy / environment (not obvious from the code)

- The **running backend is remote**: AWS EC2 app servers with a shared AWS RDS
  Postgres in a private subnet. There are separate dev and UAT trees on EC2
  sharing the RDS. Frontend deploys via **Vercel**.
- Applying a migration means running `migrate.py` on the EC2 host against RDS.
  Startup fails fast if migrations are unapplied; check `/migrations` and
  `/readyz`. Migrations are typically applied by the user (Anil) on EC2 — a
  frontend change that depends on a new backend column/route is not live until
  that deploy + migration lands.
- **Running the whole stack locally** needs no tunnel: `docker start erp-mig`
  (postgres:18 on `:5433`, already holds migrations + real data) +
  `backend/.venv/bin/uvicorn main:app --port 8000` (app object is `main:app` at
  the backend root) + `cd frontend && pnpm dev`. Locally `/readyz` is
  `degraded` with `s3: fail` (no AWS creds) — only document uploads are
  affected. Add `--host 0.0.0.0` to both servers to reach them from a phone.
- Reaching the **remote** RDS (dev/UAT data) is the SSH-tunnel path, through
  EC2 on local port 6543 (local Postgres holds 5432).

## Reporting constraint (read before promising any historical report)

**Nothing in the schema records when a loan was closed.** `loan_closures` is
empty, `audit_logs` holds a handful of rows, and there is no `closure_date` on
`loans`. Closing a loan does not settle its due-cycles either — ~2900 CLOSED
loans still carry unpaid cycles (~₹128.5M).

So a point-in-time ("as of 31 Mar") outstanding, receivable, or balance sheet
is **not derivable**: counting closed loans invents phantom debt, and filtering
by today's status silently drops every loan closed since that date. The report
date filters are therefore *cohort* filters — "the finances written in this
window, as they stand now". Balance Sheet and Overview take no window at all
(they mix loan and non-loan aggregates, so a cohort filter stops them
balancing). Enabling true as-of reporting means first backfilling a closure
date — inferable from last payment date for ~99.5% of closed loans.

## Working conventions

- **No semicolons, single quotes, trailing commas** (frontend, prettier).
- **No emojis** in code or commit messages.
- **No new markdown docs** unless asked; **don't add dependencies** without
  approval; **no hex colors** outside `tokens.css`.
- **Editing `backend/` is fine** — the running backend is still remote (EC2),
  so backend code/migration changes only go live when the user deploys them.
- **Ask, don't guess** on UX/design ambiguity.
- Confirm before risky/irreversible actions (DB writes, `git push`, deploys,
  force-push).
- Commit / push only when asked. If on `develop`, branch first.

> Note: `frontend/README.md` is the stock Vite template — ignore it; the real
> frontend guide is `frontend/AGENT_CONTEXT.md`.

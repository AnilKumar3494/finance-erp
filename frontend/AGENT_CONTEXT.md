# FinERP Frontend — Module Build Context

You are working on `/home/ak/finance-erp-frontend/frontend`, a Vite + React + TS
ERP for an Indian NBFC (Vehicle Finance). Backend is FastAPI on
`http://localhost:8000`, reached through the dev-server proxy at `/api/v1`
(run separately; do not modify).

## 1. Stack (locked — do not change without asking)

- Vite 8, React 19, TypeScript 6 (strict)
- pnpm 10, Node 22 (via nvm — run `nvm use 22` if pnpm errors with `node: not found`)
- MUI v9 (+ `@mui/icons-material`, `@mui/x-date-pickers`)
- TanStack Router v1 (file-based, Vite plugin auto-regenerates `routeTree.gen.ts`)
- TanStack Query v5 (+ devtools)
- TanStack Table v8 (when needed)
- React Hook Form v7 + `@hookform/resolvers` + Zod 4
- axios, uuid v14, dayjs

All deps already installed. Do NOT add new packages without explicit user
approval. `openapi-typescript` warning about TS ^5 is benign — ignore.

## 2. Base Directory layout

```
src/
├── api/
│   ├── client.ts                    axios instance, auth + idempotency interceptors
│   └── queries/<module>.ts          RQ hooks per module (e.g. auth.ts)
├── app/
│   ├── providers.tsx                root Providers wrapper (RQ, MUI, Auth, Theme)
│   └── auth-context.tsx             AuthProvider + useAuth()
├── components/
│   └── primitives/                  thin MUI wrappers (Btn, Card, Input, ErrorBanner...)
├── features/
│   └── <module>/                    feature code (pages/, components/, helpers)
│       └── pages/<PageName>.tsx     route's actual component lives here
├── hooks/                           cross-cutting hooks
├── lib/
│   ├── format.ts                    fmtINR, fmtDate, fmtSize, maskAadhaar, maskPan
│   └── storage.ts                   namespaced localStorage (finerp_*)
├── routes/                          TanStack Router file-based routing
│   ├── __root.tsx                   root layout + RouterDevtools
│   ├── login.tsx                    /login (public, has beforeLoad redirect-if-authed)
│   ├── _authed/                     layout group — all children require auth
│   │   ├── route.tsx                guard: throws redirect('/login') if no token
│   │   ├── index.tsx                /
│   │   └── <module>.tsx             new authenticated pages go here
│   └── routeTree.gen.ts             AUTO-GENERATED — do not edit; regenerates on `pnpm dev`
├── schemas/
│   ├── enums.ts                     Zod enums mirroring backend models (15, do not drift)
│   └── primitives.ts                Indian validators (mobile, aadhaar, pan, etc.)
├── styles/
│   ├── tokens.css                   design tokens (light + dark) — DO NOT modify color values
│   ├── globals.css                  font import, scrollbar, animation keyframes
│   └── mui-theme.ts                 reads tokens.css via getComputedStyle → MUI theme
└── main.tsx                         mount point
```

## 3. Architecture rules (locked)

1. **Design tokens are the source of truth.** Colors/radii/shadows/fonts
   live in `tokens.css`. Never write a hex value outside `tokens.css`. Read
   via MUI theme (`palette.primary.main`, `text.secondary`, etc.) or
   `var(--token-name)` in raw CSS.
2. **MUI primary, thin wrappers on top.** App code uses our wrappers
   (`<Btn>`, `<Input>`, `<Card>`, etc.) not raw MUI components, so the
   underlying lib could be swapped. New primitives → add to
   `components/primitives/` + barrel export.
3. **TanStack types must not leak.** Wrappers around TanStack Table
   accept our own `columns`/`data` types, not TanStack's.
4. **Backend is the source of truth.** Enums mirror `backend/app/models/`.
   API shapes mirror `backend/app/schemas/`. Verify via the actual files
   or `/openapi.json` before coding — do not invent.
5. **No speculation.** Every UX/design ambiguity must be asked, not
   invented. If the spec is unclear, STOP and ask.

## 4. Backend integration

- **Base URL**: `import.meta.env.VITE_API_BASE_URL`. In dev this is the
  *relative* `/api/v1` (see `frontend/.env`), which the Vite dev-server proxy
  in `vite.config.ts` forwards to `http://localhost:8000`. Keep it relative:
  an absolute `http://localhost:8000/...` breaks access from another device
  (phone on the LAN), because `localhost` then means the phone. Point the proxy
  elsewhere with `VITE_DEV_PROXY_TARGET`.
- **Auth**: JWT bearer in `Authorization` header — set automatically by
  the request interceptor in `src/api/client.ts` from `tokenStorage`.
- **401 handling**: response interceptor clears the token and hard-redirects
  to `/login`. Do not add per-call 401 handling.
- **Idempotency-Key**: auto-attached to `POST /customers` and `POST /transactions`.
  Add new paths to `IDEMPOTENT_POST_PATHS` in `client.ts` if needed.
- **Error envelope**: backend returns `{ error: { type, message, code, fields? } }`
  for most errors (see `backend/app/core/error_handlers.py`). Surface
  user-friendly text mapped from `error.response.status`, not from raw
  envelope fields.
- **Rate limiting**: 429 = rate-limited. Login: 10/min/IP. Mutations may
  also rate-limit — handle in mutation `onError`.

## 5. Code patterns

### Queries — RQ + axios

```ts
// src/api/queries/customers.ts
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'

export interface CustomerResponse {
  /* mirrors backend exactly */
}

export const customerKeys = {
  all: ['customers'] as const,
  list: (params: { page: number }) => [...customerKeys.all, 'list', params] as const,
  detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
}

export function useCustomers(params: { page: number }) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: async () => {
      const { data } = await apiClient.get<CustomerListResponse>('/customers', { params })
      return data
    },
  })
}
```

### Mutations — RQ

```ts
export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CustomerCreate) => {
      const { data } = await apiClient.post<CustomerResponse>('/customers', payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: customerKeys.all }),
  })
}
```

### Forms — RHF + Zod

```tsx
const Schema = z.object({
  mobile: primitives.mobile,  // reuse from src/schemas/primitives.ts
  pan: primitives.pan,
})
type FormValues = z.infer<typeof Schema>

const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
  resolver: zodResolver(Schema),
})

<Input {...register('mobile')} error={errors.mobile?.message} label="Mobile" required />
```

### Component state rules

- **Server state** → TanStack Query. Mutation's `error`/`isPending`/`data`
  replace useState. Query's `data`/`isLoading`/`enabled` for reads.
- **Form state** → React Hook Form. `formState.errors`, `formState.isSubmitting`.
- **URL state** → TanStack Router search params (`validateSearch` schema +
  `Route.useSearch()`).
- **Truly local UI state** (modal open, tab index, theme mode) → `useState`
  is fine. If shared across components, lift to a small context.
- **Avoid `useEffect` for derived state.** If you're syncing state from
  another state with useEffect, you probably don't need state at all —
  derive it inline.

### Routing — auth-aware

```tsx
// src/routes/_authed/customers.tsx — protected by _authed/route.tsx guard
import { createFileRoute } from '@tanstack/react-router'
import { CustomersPage } from '@/features/customers/pages/CustomersPage'

export const Route = createFileRoute('/_authed/customers')({
  component: CustomersPage,
})
```

After file changes, route tree regenerates on `pnpm dev`. If typecheck
fails with `keyof FileRoutesByPath` errors, boot vite once to regenerate:
`timeout 8 pnpm dev > /tmp/vite.log 2>&1; pnpm typecheck`.

### Error mapping (forms)

```ts
function mapError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status === 422) return 'Please check the highlighted fields.'
    if (status === 409) return 'A record with these details already exists.'
    if (status === 429) return 'Too many requests. Please wait a moment.'
    if (error.code === 'ERR_NETWORK') return 'Cannot reach server.'
  }
  return 'Something went wrong. Please try again.'
}
```

## 6. Design system

- **Tokens** (read-only): `--bg`, `--surface`, `--text`, `--text-sub`,
  `--accent` (primary blue), `--success`, `--warning`, `--danger`,
  `--border`, `--radius-md` (9px), `--radius-lg` (14px),
  `--shadow-card`, etc. See `src/styles/tokens.css`.
- **Light/dark**: `:root` for light, `[data-theme="dark"]` for dark.
  `ThemeModeProvider` (in `src/hooks/useTheme.tsx`) owns the toggle.
- **MUI theme bridge**: `src/styles/mui-theme.ts` reads tokens via
  `getComputedStyle` at theme-build time. Rebuilt on mode change.
- **Primitives in `src/components/primitives/`**:
  - `<Btn variant="primary|outline|ghost|success|danger" size="sm|md" loading>`
    — `outline` is a bordered secondary action: use it when something must read
    as a real button but must not compete with the view's filled primary CTA.
    `ghost` is a text button (reads as a link).
  - `<Card>` — Paper, p:3 default
  - `<Input label required error={msg}>` — RHF-compatible (forwards ref)
  - `<FieldLabel required>` — label + accent asterisk
  - `<ErrorBanner message>` — filled-red Alert
  - `<Spinner size={20}>`
- **Required-field marker**: small accent `*` after label (built into
  `<FieldLabel>` / `<Input required>`).
- **Field-level errors**: 11px / 500-weight / danger color, under input
  (handled by `<Input error="...">`).
- **Non-field errors**: top-of-form `<ErrorBanner>`.
- **Typography scale** (MUI theme): h1=28, h2=18, h3=17, body1=14,
  body2=13, caption=11.

## 7. Conventions

- **No semicolons** (matches prettier config). Single quotes. Trailing commas.
- **Imports**: external first, then `@/...` aliases, then relative. Type-only
  imports use `import type`.
- **File names**: PascalCase for components (`CustomerCard.tsx`), camelCase
  for hooks/utils (`useFoo.ts`, `format.ts`), kebab-case for multi-word
  context/page files only when convention demands.
- **One component per file** for primitives and pages. Barrel `index.ts` for
  collections.
- **Comments**: write none by default. Only when WHY is non-obvious (hidden
  constraint, workaround, subtle invariant). Never explain WHAT — code does that.
- **No emojis** in code or commit messages.
- **No README/docs files** unless asked.

## 8. Common gotchas

- **MUI v9 Stack**: `alignItems` is NOT a top-level prop. Use `sx={{ alignItems: 'center' }}`.
- **MUI icons-material naming**: it's `CheckCircleOutlineOutlined`, not
  `CheckCircleOutline`. When in doubt, `ls node_modules/@mui/icons-material | grep -i <name>`.
- **JSX in `.ts` file**: rename to `.tsx`. Vite/TS won't resolve aliases differently.
- **routeTree.gen.ts stale**: after any add/move/delete under `src/routes/`,
  run `pnpm dev` briefly to regenerate before typechecking.
- **`pnpm: node: not found`**: nvm isn't auto-loaded; run `nvm use 22` first,
  or prefix commands: `export PATH=/home/ak/.nvm/versions/node/v22.17.0/bin:$PATH`.
- **Zod v4 + RHF**: `@hookform/resolvers v5+` supports Zod 4. Use
  `useForm<MyType>({ resolver: zodResolver(MySchema) })` with explicit type
  parameter to avoid inference quirks.
- **Open-redirect**: any `?redirect=` from URL must pass `sanitizeRedirect()`
  before navigating (see `src/features/auth/redirect.ts`). Reject anything not
  starting with a single `/`.
- **Lint rule `react-refresh/only-export-components`**: a `.tsx` file may export
  components *only*. Putting helper functions/constants beside a component trips
  it — put them in a sibling `.ts` (e.g. `features/reports/dateRange.ts` next to
  `components/ReportDateRange.tsx`).
- **Reports date filters**: the six windowed reports share
  `features/reports/dateRange.ts` (`DateRangeValue`, `EMPTY_RANGE`,
  `isoOrUndefined`, `rangeError`) and `components/ReportDateRange.tsx`. Both
  bounds are optional and start empty = unbounded, so an untouched report
  returns everything. Query keys MUST include the window or two windows share
  one cache entry (see `win()` in `api/queries/reports.ts`).
- **A date filter is only real if the endpoint takes it.** Before adding a
  picker, confirm the param exists in `backend/app/api/v1/routes/` or
  `/openapi.json` — several report endpoints take none, and a control that
  changes nothing is worse than no control.

## 9. Recipe — building a new module

For a hypothetical `customers` module:

1. **Verify backend contracts.**
   - `cat backend/app/api/v1/routes/customers.py` — endpoints, methods, status codes
   - `cat backend/app/schemas/customer.py` — request/response shapes
   - `cat backend/app/models/customer.py` — enums, field nullability
   - Reconcile any new enums into `src/schemas/enums.ts`.
2. **Add queries.** `src/api/queries/customers.ts` — types matching backend
   schemas, `customerKeys` registry, `useCustomers`, `useCustomer`,
   `useCreateCustomer`, `useUpdateCustomer`.
3. **Build the page.** `src/features/customers/pages/CustomersListPage.tsx`,
   `CustomerDetailPage.tsx`, etc. Use primitives. Errors via mapError pattern.
4. **Wire the route.** `src/routes/_authed/customers/index.tsx` (list),
   `src/routes/_authed/customers/$customerId.tsx` (detail). Routes are tiny
   wrappers around the feature page.
5. **Typecheck**: `pnpm typecheck` after route changes (regenerate route tree
   first if needed).
6. **Verify in browser**: `pnpm dev` → click through the flow. Watch Network
   tab for request shape + headers.

## 10. Definition of done

- `pnpm typecheck` passes.
- `pnpm dev` serves on :5173 (strict port) with no console errors on page load.
- Feature works end-to-end against the real backend with a real user.
- No new dependencies added without approval.
- No hex colors outside tokens.css.
- No useState/useEffect for state RQ or RHF already tracks.
- No emojis. No new markdown docs. No comments explaining WHAT.

## 11. Working with the user

- **Checkpoint per step** by default — finish a discrete unit, summarize what
  changed, wait for explicit "go" before the next step.
- **For exploratory questions**: 2-3 sentences with a recommendation and the
  main tradeoff. Not a decided plan.
- **For risky actions** (DB writes, git push, deploys, force-push, anything
  hard to undo): confirm before doing.
- **Never modify `backend/`** unless explicitly asked. Adding to
  `backend/.gitignore` for safety is OK.
- **Local DB is Docker, not a tunnel.** `docker start erp-mig` (postgres:18,
  host `:5433` → container `:5432`) is what `backend/.env` targets
  (`DB_HOST=localhost DB_PORT=5433`); it already holds applied migrations and
  real data. Run the API with `backend/.venv/bin/uvicorn main:app --port 8000`
  (the app object is `main:app`, at the backend root — not `app.main`).
  `/readyz` returns `degraded` with `s3: fail` locally (no AWS creds); db and
  migrations read `ok`. Only document/S3 uploads are affected.
- The **shared AWS RDS** (private subnet) is the *remote* dev/UAT path, reached
  by SSH tunnel through EC2 on local port 6543 (5432 is taken):
  `ssh -i ~/.ssh/key_erp_dev_server.pem -N -L 6543:erp-db-dev.<host>:5432 ubuntu@<ec2>`.
  Use it only when you genuinely need remote data.

## 12. Reference — auth module (already built)

The auth module on branch `fe/auth-login` is the reference implementation.
Mirror its patterns:

- Queries: `src/api/queries/auth.ts` — useLogin, useMe, useLogout + types
  - keys.
- Provider: `src/app/auth-context.tsx` — context + useAuth hook.
- Page: `src/features/auth/pages/LoginPage.tsx` — RHF + Zod, mutation-state-
  driven errors, two-column responsive layout.
- Route: `src/routes/login.tsx` — search schema, beforeLoad redirect.
- Guard: `src/routes/_authed/route.tsx` — token check, throw redirect.
- Primitives in use: `<Btn loading>`, `<Card>`, `<Input error>`, `<ErrorBanner>`,
  `<Spinner>`.

Read those before starting any new auth-adjacent or form-heavy work.

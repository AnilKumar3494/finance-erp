# Backend code style

Short note covering the conventions that aren't enforced by formatter or
linter, but that we want consistency on across the modular monolith.

## SQLAlchemy filters

### `is_deleted` comparisons — use `Model.is_deleted == False`

Two equivalent idioms work in SQLAlchemy 2.0:

```python
.filter(Customer.is_deleted == False)   # ← USE THIS, with the noqa below
.filter(Customer.is_deleted.is_(False))
```

Pick the first form, suffixed with `# noqa: E712` so pyflakes / flake8
don't complain. Rationale:

- It reads as the SQL it generates (`is_deleted = false`), which matches
  how indexes are declared (`WHERE is_deleted = false`).
- ~80% of the codebase already uses this form; mixing styles makes diffs
  noisy when a developer copy-pastes the "other" idiom.

The `is_(False)` form is fine in isolated files (e.g. `services/transaction.py`,
`services/penalty.py`) where it's used consistently throughout — but
when **adding** code to a file, match the file's existing idiom rather
than introducing the mixed style.

If we ever need a code-level rule for this, swap to a `ruff` rule
(`E712` is the relevant code) configured to allow both forms.

## Imports

- Local imports inside a function only when breaking a real circular
  dependency at module load. Otherwise put the import at the top.
- Routes import services; services do NOT import routes.
- Cross-domain service calls go through a thin facade (`is_blocking_vehicle`,
  `validate_document_link`) — don't reach across into another domain's
  internals.

## Error envelope

Every error response goes through `app.core.error_handlers`. Routes
should raise `HTTPException`, return `ValueError` from services, or let
unexpected exceptions bubble — the global handler converts each to the
single `{ "error": { type, message, code, fields? } }` envelope.

Exception: `RateLimitExceeded` keeps its slowapi-native shape because it
carries a `Retry-After` header.

## Audit

Every privileged action (create / update / delete / state transition)
should write a row via `app.utils.audit.write_audit`. Audit writes use
a SAVEPOINT — they never fail the caller's transaction.

Never log raw PII values (`id_number`, `aadhaar_number`, etc.) in audit
payloads. Log presence flags (`"has_id_number": true`) instead.

## Soft delete

Use `model.soft_delete(by_id)` / `model.restore(by_id)` from `AuditBase`.
Don't hand-set `is_deleted` / `deleted_at` — the helpers keep the
`check_soft_delete_*` CHECK constraints happy and stamp
`updated_by_id` correctly.

## Migrations

- One numbered SQL file per change under `backend/migrations/`.
- Apply via `python migrate.py apply` (NOT `psql -f`) so the
  `schema_migrations` tracker stays in sync.
- Wrap DDL in `BEGIN; ... COMMIT;` inside the file.
- Add pre-flight `DO $$ ... RAISE EXCEPTION ... $$` blocks for any
  `SET NOT NULL` / dropped constraint so a partially-applied migration
  is impossible.
- Never rewrite a migration file after it's been applied to any
  environment. Fix forward with a new file.

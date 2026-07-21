# backend/scripts

Operational scripts. Run from `backend/` with the app's `.env` in place.

## Provisioning a database

There are two distinct situations. Pick the right one.

### Fresh / empty database (new env, CI, disaster recovery)

Use **`init_db`**. The numbered migrations in `migrations/` are a chain of
*transformations* on a schema that predates migration 001, so
`migrate.py apply` against an empty database fails at 001
(`type "doc_category" does not exist`) and the app then refuses to boot.

```bash
python -m scripts.init_db                 # schema + stamp migrations
python -m scripts.init_db --with-admin     # also seed a SUPER_ADMIN
```

`--with-admin` reads:

- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_FULL_NAME` (optional)

`init_db` builds the schema from the SQLAlchemy models, adds the partial-unique
duplicate-guard indexes that live only in migration SQL, and stamps every
migration as applied so `migrate.py status` reports `0 pending` and the startup
fail-fast passes. It is idempotent.

> It is functionally equivalent to a migrated database for the application, but
> not a byte-for-byte `pg_dump` of production. For an exact production replica,
> restore a `pg_dump --schema-only` of prod instead.

### Existing database (already has the schema)

Keep using the migration runner — **do not** run `init_db` against it.

```bash
python migrate.py status    # applied vs pending
python migrate.py apply     # apply pending migrations
```

## Other scripts

- `reports_integration_check.py` — read-only reports smoke test (rolls back).
- `validate_lifecycle.py` — loan-lifecycle validation.

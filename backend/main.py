from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_swagger_ui_theme import setup_swagger_ui_theme
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.error_handlers import register_error_handlers
from app.core.logging_config import configure_logging
from app.core.rate_limit import limiter
from app.core.scheduler import start_scheduler, stop_scheduler
from app.api.v1.routes import (
    auth,
    customers,
    vehicles,
    loans,
    transactions,
    documents,
    reports,
    due_cycles,
)
from app.api.v1.routes.personnel import personnel_router, loan_personnel_router
from app.api.v1.routes.identity_proofs import router as identity_proofs_router
from app.api.v1.routes.stability_documents import router as stability_documents_router

# Import AuditLog so SQLAlchemy registers the mapper.
from app.models.audit_log import AuditLog  # noqa: F401

# Import DueCycle so SQLAlchemy registers the mapper for the new lifecycle tables.
from app.models.due_cycle import DueCycle  # noqa: F401
from app.models.penalty_event import PenaltyEvent  # noqa: F401
from app.models.loan_closure import LoanClosure  # noqa: F401
from app.models.bad_debt_proposal import BadDebtProposal  # noqa: F401

from app.api.v1.routes.bad_debt import (
    propose_router as bad_debt_propose_router,
    review_router as bad_debt_review_router,
)


# --------------------------------------------------
# LOGGING (must happen before app init)
# --------------------------------------------------
configure_logging()

# --------------------------------------------------
# APP INIT
# --------------------------------------------------
app = FastAPI(
    title="FinERP API TESTING",
    description="Loan Management System API",
    version="1.0.0",
    docs_url=None,  # Swagger UI (theme replaces it)
    redoc_url="/redoc",  # ReDoc UI
)


setup_swagger_ui_theme(app, docs_path="/docs")

# --------------------------------------------------
# RATE LIMITING (slowapi)
#   - Limiter is IP-keyed (see app/core/rate_limit.py).
#   - Per-route limits are applied via @limiter.limit(...) decorators
#     in the route modules. Routes decorated this way MUST declare
#     `request: Request` as a parameter.
# --------------------------------------------------
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# --------------------------------------------------
# GLOBAL ERROR ENVELOPE (G2 / G5)
# Wraps HTTPException, RequestValidationError, SQLAlchemyError, and any
# unhandled Exception into one consistent JSON shape for the frontend.
# RateLimitExceeded is intentionally NOT in here — it has its own slowapi
# handler above that preserves the retry-after header.
# --------------------------------------------------
register_error_handlers(app)

# --------------------------------------------------
# CORS — origin list comes from settings.CORS_ORIGINS (env-driven).
# Local default covers dev; production deployments must override the env var.
# --------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------
# ROUTERS
# --------------------------------------------------
app.include_router(auth.router, prefix="/api/v1")
app.include_router(customers.router, prefix="/api/v1")
app.include_router(personnel_router, prefix="/api/v1")
app.include_router(loan_personnel_router, prefix="/api/v1")
app.include_router(identity_proofs_router, prefix="/api/v1")
app.include_router(stability_documents_router, prefix="/api/v1")
app.include_router(vehicles.router, prefix="/api/v1")
app.include_router(loans.router, prefix="/api/v1")
app.include_router(transactions.router, prefix="/api/v1")
app.include_router(due_cycles.router, prefix="/api/v1")
app.include_router(bad_debt_propose_router, prefix="/api/v1")
app.include_router(bad_debt_review_router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")


# --------------------------------------------------
# LIFECYCLE — nightly cycle-check scheduler (N1)
#
# The scheduler is started on app startup and stopped on shutdown. It
# uses a Postgres advisory lock internally so running multiple workers
# does not double-fire the job. Toggle via NIGHTLY_JOB_ENABLED in env.
# --------------------------------------------------
@app.on_event("startup")
def _startup_scheduler() -> None:
    start_scheduler()


@app.on_event("shutdown")
def _shutdown_scheduler() -> None:
    stop_scheduler()


# --------------------------------------------------
# HEALTH / READINESS
# --------------------------------------------------
# `/health` is intentionally SHALLOW — process-is-up, useful for k8s
# liveness probes that should NOT restart the pod just because the DB is
# temporarily unreachable.
#
# `/readyz` is DEEP — verifies the dependencies the app actually needs to
# serve requests (DB connectivity, S3 reachability). Use this for k8s
# readiness probes and ALB target-group health checks.
# --------------------------------------------------
@app.get("/health", tags=["System"])
def health_check():
    """Liveness — process is up. Does not touch external systems."""
    return {"status": "ok", "version": "1.0.0"}


@app.get("/readyz", tags=["System"])
def readiness_check():
    """Readiness — DB + S3 reachable. Returns 503 if any dep is down.

    Checks performed:
      - `SELECT 1` against the configured Postgres instance.
      - `head_bucket` against the configured S3 bucket. We don't validate
        write permissions (an upload would be too expensive) but we DO
        confirm the bucket exists and our IAM role can see it.
    """
    from fastapi import HTTPException
    import logging as _logging

    log = _logging.getLogger("readyz")
    checks: dict[str, str] = {}

    # --- DB
    try:
        from sqlalchemy import text
        from app.core.db import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as exc:  # noqa: BLE001 — probe must not crash
        checks["db"] = "fail"
        log.exception("readyz db check failed: %s", exc)

    # --- S3
    try:
        from botocore.exceptions import ClientError
        from app.utils.s3 import get_s3_client

        get_s3_client().head_bucket(Bucket=settings.S3_BUCKET_NAME)
        checks["s3"] = "ok"
    except ClientError as exc:
        checks["s3"] = "fail"
        log.warning("readyz s3 check failed: %s", exc)
    except Exception as exc:  # noqa: BLE001
        checks["s3"] = "fail"
        log.exception("readyz s3 check failed: %s", exc)

    if any(v != "ok" for v in checks.values()):
        raise HTTPException(status_code=503, detail={"status": "degraded", "checks": checks})
    return {"status": "ok", "checks": checks}

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_swagger_ui_theme import setup_swagger_ui_theme
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.logging_config import configure_logging
from app.core.rate_limit import limiter
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
# CORS
# --------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Frontend
        "http://localhost:8000",  # Swagger UI via localhost
        "http://127.0.0.1:8000",  # Swagger UI via 127.0.0.1
    ],
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
# HEALTH CHECK
# --------------------------------------------------
@app.get("/health", tags=["System"])
def health_check():
    """Quick endpoint to verify the API is running"""
    return {"status": "ok", "version": "1.0.0"}

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_swagger_ui_theme import setup_swagger_ui_theme

from app.core.logging_config import configure_logging
from app.api.v1.routes import (
    auth,
    customers,
    vehicles,
    loans,
    transactions,
    documents,
    reports,
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
    docs_url=None,  # Swagger UI
    redoc_url="/redoc",  # ReDoc UI
)


setup_swagger_ui_theme(app, docs_path="/docs")


# --------------------------------------------------
# CORS (Cross Origin Resource Sharing)
# Controls which frontends can talk to this API
# --------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # Frontend
        "http://localhost:8000",   # Swagger UI via localhost
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
app.include_router(vehicles.router, prefix="/api/v1")
app.include_router(loans.router, prefix="/api/v1")
app.include_router(transactions.router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")


# --------------------------------------------------
# HEALTH CHECK
# --------------------------------------------------
@app.get("/health", tags=["System"])
def health_check():
    """Quick endpoint to verify the API is running"""
    return {"status": "ok", "version": "1.0.0"}

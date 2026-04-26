from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# from app.core.config import settings
from app.api.v1.routes import auth, customers

# --------------------------------------------------
# APP INIT
# --------------------------------------------------
app = FastAPI(
    title="Your App Name",
    description="Loan Management System API",
    version="1.0.0",
    docs_url="/docs",  # Swagger UI
    redoc_url="/redoc",  # ReDoc UI
)

# --------------------------------------------------
# CORS (Cross Origin Resource Sharing)
# Controls which frontends can talk to this API
# --------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Add your frontend URL here
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------
# ROUTERS
# --------------------------------------------------
app.include_router(auth.router, prefix="/api/v1")
app.include_router(customers.router, prefix="/api/v1")

# Add future routers here:
# app.include_router(customers.router, prefix="/api/v1")
# app.include_router(loans.router,     prefix="/api/v1")
# app.include_router(vehicles.router,  prefix="/api/v1")


# --------------------------------------------------
# HEALTH CHECK
# --------------------------------------------------
@app.get("/health", tags=["System"])
def health_check():
    """Quick endpoint to verify the API is running"""
    return {"status": "ok", "version": "1.0.0"}

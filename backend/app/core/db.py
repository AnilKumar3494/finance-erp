from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

# --------------------------------------------------
# ENGINE
# --------------------------------------------------
engine = create_engine(
    settings.DATABASE_URL,
    pool_size=10,  # Max permanent connections
    max_overflow=20,  # Extra connections during peaks
    pool_pre_ping=True,  # Reconnect if DB drops connection
    pool_recycle=1800,  # Recycle connections every 30 mins
)

# --------------------------------------------------
# SESSION FACTORY
# --------------------------------------------------
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


# --------------------------------------------------
# BASE (All models inherit from this)
# --------------------------------------------------
class Base(DeclarativeBase):
    pass


# --------------------------------------------------
# DEPENDENCY (One session per request)
# --------------------------------------------------
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

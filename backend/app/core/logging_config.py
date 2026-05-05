import logging
from logging.config import dictConfig

from app.core.config import settings


def configure_logging() -> None:
    """
    Project-wide logging setup.
    Call once at app startup
    Use `logger = logging.getLogger(__name__)` in any module afterwards.
    """
    config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "format": (
                    "%(asctime)s | %(levelname)-8s | %(name)s "
                    "| %(funcName)s:%(lineno)d | %(message)s"
                ),
                "datefmt": "%Y-%m-%d %H:%M:%S",
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "default",
                "level": settings.LOG_LEVEL,
            },
        },
        "loggers": {
            # Our app code
            "app": {
                "handlers": ["console"],
                "level": settings.LOG_LEVEL,
                "propagate": False,
            },
            # Tame noisy third parties
            "uvicorn.access": {"level": "WARNING"},
            "botocore": {"level": "WARNING"},
            "boto3": {"level": "WARNING"},
            "sqlalchemy.engine": {"level": "WARNING"},
        },
        "root": {
            "handlers": ["console"],
            "level": settings.LOG_LEVEL,
        },
    }
    dictConfig(config)
    logging.getLogger(__name__).info(
        "Logging configured at level %s", settings.LOG_LEVEL
    )

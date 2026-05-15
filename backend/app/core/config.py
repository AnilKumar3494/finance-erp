from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import computed_field, field_validator
from functools import lru_cache


class Settings(BaseSettings):
    # --------------------------------------------------
    # DATABASE
    # --------------------------------------------------
    DB_USER: str
    DB_PASSWORD: str
    DB_HOST: str
    DB_PORT: str = "5432"
    DB_NAME: str = "postgres"

    # --------------------------------------------------
    # JWT / AUTH
    # --------------------------------------------------
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 Hours

    # --------------------------------------------------
    # LOGIN SECURITY (Lockout + Rate Limit)
    # --------------------------------------------------
    LOGIN_MAX_FAILED_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15
    # slowapi-compatible strings. IP-keyed.
    RATE_LIMIT_LOGIN: str = "10/minute"
    RATE_LIMIT_REGISTER: str = "3/minute"

    # --------------------------------------------------
    # AWS
    # --------------------------------------------------
    AWS_REGION: str = "ap-south-1"
    S3_BUCKET_NAME: str
    KMS_KEY_ID: Optional[str] = None

    # --------------------------------------------------
    # DOCUMENTS
    # --------------------------------------------------
    MAX_DOCUMENT_UPLOAD_BYTES: int = 10 * 1024 * 1024  # 10 MB
    PRESIGNED_URL_TTL_SECONDS: int = 480  # 8 minutes
    ALLOWED_DOCUMENT_EXTENSIONS: set[str] = {
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".doc",
        ".docx",
        ".txt",
        ".webp",
    }
    ALLOWED_DOCUMENT_MIME_TYPES: set[str] = {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
    }

    # --------------------------------------------------
    # LOGGING
    # --------------------------------------------------
    LOG_LEVEL: str = "INFO"  # DEBUG, INFO, WARNING, ERROR

    # --------------------------------------------------
    # VALIDATORS
    # --------------------------------------------------
    @field_validator("SECRET_KEY")
    @classmethod
    def _secret_key_strength(cls, v: str) -> str:
        if not v or len(v) < 32:
            raise ValueError(
                "SECRET_KEY must be at least 32 characters long. "
                "Generate one with: openssl rand -hex 32"
            )
        return v

    @field_validator("ALGORITHM")
    @classmethod
    def _algorithm_whitelist(cls, v: str) -> str:
        # HS256/HS384/HS512 are the symmetric variants we support.
        allowed = {"HS256", "HS384", "HS512"}
        if v not in allowed:
            raise ValueError(f"JWT ALGORITHM must be one of {allowed}")
        return v

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql+psycopg2://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, computed_field, field_validator
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
    LOGIN_MAX_FAILED_ATTEMPTS: int = Field(default=5, ge=1)
    LOGIN_LOCKOUT_MINUTES: int = Field(default=15, ge=1)
    # slowapi-compatible strings. IP-keyed.
    RATE_LIMIT_LOGIN: str = "10/minute"
    RATE_LIMIT_REGISTER: str = "3/minute"
    # Throttle identity lookups (Aadhaar/PAN/mobile probes) to blunt
    # PII-enumeration attempts. IP-keyed.
    RATE_LIMIT_LOOKUP: str = "30/minute"

    # --------------------------------------------------
    # PROXY / CLIENT IP
    # X-Forwarded-For is client-spoofable. Only honor it when the app is
    # actually deployed behind a trusted proxy/ALB that appends the real
    # client IP. Default OFF → audit logs record the spoof-proof
    # request.client.host. Set TRUST_FORWARDED_FOR=true ONLY when an ALB /
    # reverse proxy fronts the app, and set TRUSTED_PROXY_HOPS to the number
    # of trusted proxies in the chain (1 for a single ALB).
    # --------------------------------------------------
    TRUST_FORWARDED_FOR: bool = False
    TRUSTED_PROXY_HOPS: int = Field(default=1, ge=1)

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
    # REPORTING
    # --------------------------------------------------
    # Business timezone for date-bucketing in reports. The DB stores
    # timestamptz in UTC; reports convert via AT TIME ZONE so a payment
    # entered at 23:30 IST on the 30th stays in that day's bucket.
    REPORTS_TIMEZONE: str = "Asia/Kolkata"

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

    @field_validator("REPORTS_TIMEZONE")
    @classmethod
    def _reports_timezone_is_real(cls, v: str) -> str:
        # Fail at app startup on a typo (e.g. "Asia/Kolkat") rather than at
        # the first report query, where the error would be a buried Postgres
        # exception with a stack trace.
        try:
            ZoneInfo(v)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(
                f"REPORTS_TIMEZONE={v!r} is not a valid IANA timezone "
                "(e.g. 'Asia/Kolkata', 'UTC', 'America/New_York')"
            ) from exc
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

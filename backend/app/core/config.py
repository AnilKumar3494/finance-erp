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
    # Cap document upload volume per IP — protects S3 PUT spend and worker
    # memory (each upload spools up to MAX_DOCUMENT_UPLOAD_BYTES).
    RATE_LIMIT_UPLOAD: str = "20/minute"

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
    # CORS
    # --------------------------------------------------
    # Comma-separated list of origins allowed to call the API with
    # credentials. Defaults to local dev so a fresh checkout works without
    # extra env config; production deploys MUST set this explicitly
    # (e.g. CORS_ORIGINS="https://app.example.com,https://admin.example.com").
    # Wildcard "*" is intentionally NOT supported because allow_credentials=True
    # is incompatible with wildcard origins under the CORS spec.
    CORS_ORIGINS: str = (
        "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173, http://localhost:8008,http://127.0.0.1:8008, http://localhost:8000,http://127.0.0.1:8000"
    )

    @field_validator("CORS_ORIGINS")
    @classmethod
    def _no_wildcard_origin(cls, v: str) -> str:
        # The CORS spec disallows `Access-Control-Allow-Origin: *` when
        # `Access-Control-Allow-Credentials: true`. Our middleware sends
        # credentials, so a wildcard would either be silently ignored by
        # the browser (failing every authenticated XHR) or — worse — be
        # accepted by a misconfigured proxy and broaden the exposure.
        # Reject at parse time so a typo in env can't ship.
        for raw in v.split(","):
            origin = raw.strip()
            if origin == "*":
                raise ValueError(
                    "CORS_ORIGINS must not contain '*' — allow_credentials=True "
                    "is incompatible with wildcard origins. Set explicit URLs."
                )
        return v

    @computed_field
    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

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
    # NIGHTLY JOB (cycle promotion + cap auto-classify)
    # --------------------------------------------------
    # Embeds an APScheduler that fires nightly_cycle_check at the chosen
    # hour in REPORTS_TIMEZONE. Multi-worker setups are safe because the
    # job grabs a Postgres advisory lock before running — only one worker
    # ever does the work per fire. Set NIGHTLY_JOB_ENABLED=false in CI /
    # local dev to keep the scheduler dormant.
    NIGHTLY_JOB_ENABLED: bool = True
    NIGHTLY_JOB_HOUR: int = Field(default=2, ge=0, le=23)     # 02:00 IST
    NIGHTLY_JOB_MINUTE: int = Field(default=0, ge=0, le=59)
    # Advisory-lock key. Arbitrary 64-bit int; any deployment that shares
    # a database must share this value so the lock actually serialises.
    NIGHTLY_JOB_LOCK_KEY: int = 0xF1E_C1C_E  # 253_656_270 — "fnce_cyc"

    # --------------------------------------------------
    # WHATSAPP EMI REMINDERS (Meta Cloud API)
    # --------------------------------------------------
    # Reminders go out ahead of each EMI due date via the Meta WhatsApp
    # Cloud API. Two layers of switch:
    #   - WHATSAPP_ENABLED (this env flag) gates whether the reminder job is
    #     REGISTERED with the scheduler at startup. Keep false in CI / local.
    #   - whatsapp_settings.reminders_enabled (a DB row, editable from the
    #     admin UI) is the runtime on/off the job checks on every fire — so
    #     staff can pause reminders without a redeploy.
    WHATSAPP_ENABLED: bool = False
    # Dry-run renders + logs the intended messages and writes DRY_RUN rows to
    # whatsapp_reminder_log, but never calls Meta. Lets the whole pipeline be
    # validated before go-live. Flip to false only once a template is approved.
    WHATSAPP_DRY_RUN: bool = True
    # Meta Cloud API credentials. From WhatsApp → API Setup (phone_number_id)
    # and a permanent System-User token (see WHATSAPP_SETUP.md). Required only
    # when WHATSAPP_ENABLED and not WHATSAPP_DRY_RUN.
    WHATSAPP_PHONE_NUMBER_ID: Optional[str] = None
    WHATSAPP_ACCESS_TOKEN: Optional[str] = None
    WHATSAPP_API_VERSION: str = "v21.0"
    # Default calling code prepended to bare 10-digit numbers when
    # normalising to E.164 (India = 91 → +91XXXXXXXXXX).
    WHATSAPP_DEFAULT_COUNTRY_CODE: str = "91"
    # When the reminder job fires, in REPORTS_TIMEZONE.
    WHATSAPP_JOB_HOUR: int = Field(default=9, ge=0, le=23)    # 09:00 IST
    WHATSAPP_JOB_MINUTE: int = Field(default=0, ge=0, le=59)
    # Advisory-lock key — MUST differ from NIGHTLY_JOB_LOCK_KEY so the two
    # scheduled jobs never block each other.
    WHATSAPP_JOB_LOCK_KEY: int = 0xF1E_5A5A  # 253_647_450 — "fnce_sms"

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

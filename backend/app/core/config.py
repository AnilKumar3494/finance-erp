from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, computed_field, field_validator
from functools import lru_cache


# --------------------------------------------------
# DOCUMENT UPLOAD RULES
# --------------------------------------------------
# extension -> (MIME we store on the object, MIME values libmagic may report
# for a genuine file of that kind).
#
# Why one map instead of two independent allow-lists: the extension list and
# the MIME list used to be maintained separately and drifted apart, so ".doc"
# and several ordinary ".txt" files were advertised as supported but could
# never actually be uploaded. Deriving both from this map makes that drift
# impossible, and checking the sniffed type against *the declared extension*
# (rather than against one flat set) also rejects a file whose bytes disagree
# with its name — a PDF renamed to .png used to be accepted and then stored
# under the misleading name.
DOCUMENT_TYPE_RULES: dict[str, tuple[str, frozenset[str]]] = {
    ".pdf": ("application/pdf", frozenset({"application/pdf"})),
    ".png": ("image/png", frozenset({"image/png"})),
    ".jpg": ("image/jpeg", frozenset({"image/jpeg"})),
    ".jpeg": ("image/jpeg", frozenset({"image/jpeg"})),
    ".webp": ("image/webp", frozenset({"image/webp"})),
    # Legacy Word is an OLE2 compound file. libmagic only names the specific
    # member of that family once it has read the container's sector table,
    # and reports several spellings depending on build, so accept the family
    # and store the canonical Word type.
    ".doc": (
        "application/msword",
        frozenset(
            {
                "application/msword",
                "application/x-ole-storage",
                "application/CDFV2",
                "application/vnd.ms-office",
            }
        ),
    ),
    ".docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        frozenset(
            {
                "application/vnd.openxmlformats-officedocument"
                ".wordprocessingml.document",
                # An OOXML package written by an older tool sniffs as a
                # plain zip when it carries no recognisable part ordering.
                "application/zip",
            }
        ),
    ),
    # Plain text is whatever libmagic decides the prose looks like: commas
    # make it text/csv, angle brackets text/html, braces application/json.
    # They are all plain text to us. Storing them as text/plain regardless
    # means S3 can never serve one of them back as a renderable document.
    ".txt": (
        "text/plain",
        frozenset(
            {
                "application/csv",
                "application/json",
                "text/csv",
                "text/html",
                "text/plain",
                "text/xml",
            }
        ),
    ),
}


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
    # Both derived from DOCUMENT_TYPE_RULES so they can never disagree with
    # each other. Still overridable by env for an operator who wants to
    # narrow what this deployment accepts — the upload route intersects the
    # per-extension rule with the MIME list, so removing an entry here takes
    # effect even though the rules map is a code-level constant.
    ALLOWED_DOCUMENT_EXTENSIONS: set[str] = Field(
        default_factory=lambda: set(DOCUMENT_TYPE_RULES)
    )
    ALLOWED_DOCUMENT_MIME_TYPES: set[str] = Field(
        default_factory=lambda: {
            mime
            for _, accepted in DOCUMENT_TYPE_RULES.values()
            for mime in accepted
        }
    )

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
    # When True the nightly job auto-classifies a capped cycle and flips the
    # loan to BAD_DEBT_PROPOSED (spreading the penalty). When False it runs in
    # ADVISORY mode: it still records the cap-crossing (an audit row, for
    # pattern analysis) and surfaces it as a suggestion, but changes no loan or
    # cycle state — a human proposes bad debt manually.
    #
    # Defaults to False: automation stays OFF until the penalty-cap policy
    # (36%/month default) is validated against real collections. Set
    # NIGHTLY_AUTO_PROPOSE_BAD_DEBT=true in the environment to enable it.
    NIGHTLY_AUTO_PROPOSE_BAD_DEBT: bool = False
    # Advisory-lock key. Arbitrary 64-bit int; any deployment that shares
    # a database must share this value so the lock actually serialises.
    NIGHTLY_JOB_LOCK_KEY: int = 0xF1E_C1C_E  # 253_656_270 — "fnce_cyc"

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

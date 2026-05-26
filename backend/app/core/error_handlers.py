"""
Single global error envelope.

Why this exists
---------------
Without these handlers, three FastAPI exception classes each produce a
different JSON shape:

  - HTTPException             -> {"detail": "..."}
  - RequestValidationError    -> {"detail": [{"loc": [...], "msg": "...", "type": "..."}, ...]}
  - SQLAlchemyError + anything else  -> a full traceback dump from the
    default Starlette 500 handler.

The frontend would need three render paths plus a "what is this thing"
branch. We collapse all four into one envelope so the table-of-errors
component the frontend builds once works everywhere:

    {
        "error": {
            "type":    "http_error" | "validation_error" | "server_error" | "rate_limit_exceeded",
            "message": "...human-readable...",
            "code":    <http status as int>,
            "fields":  [ {"loc": "...", "msg": "..."}, ... ]   # only on validation errors
        }
    }

We deliberately do NOT include exception class names, stack traces, or
constraint names in the response — those go to the server log only. For
NBFC compliance that means a 500 NEVER leaks SQL or PII to the wire.

Register with `register_error_handlers(app)` from main.py.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("error_handler")


def _envelope(
    *,
    type_: str,
    message: Any,
    code: int,
    fields: list[dict] | None = None,
) -> dict:
    body: dict = {"error": {"type": type_, "message": message, "code": code}}
    if fields:
        body["error"]["fields"] = fields
    return body


async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    # HTTPException.detail may be a string, list, or dict — we pass it
    # through as-is in `message` so existing route code that returns
    # structured details (e.g. /readyz `{"status": "degraded", ...}`)
    # keeps working.
    return JSONResponse(
        status_code=exc.status_code,
        content=_envelope(
            type_="http_error", message=exc.detail, code=exc.status_code
        ),
        headers=getattr(exc, "headers", None),
    )


async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Strip the loc to a dotted path string and drop pydantic-internal
    # fields. Keep the per-field message so a form UI can pin errors next
    # to inputs.
    fields = [
        {
            "loc": ".".join(str(p) for p in err.get("loc", []) if p != "body"),
            "msg": err.get("msg", ""),
        }
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_envelope(
            type_="validation_error",
            message="Validation failed",
            code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            fields=fields,
        ),
    )


async def _sqlalchemy_exception_handler(
    request: Request, exc: SQLAlchemyError
) -> JSONResponse:
    # Never leak the exception class or driver message — both can embed
    # bound parameters, schema names, or constraint internals. The route
    # already had a chance to translate IntegrityError into a clean
    # ValueError; anything reaching this handler is genuinely unexpected.
    logger.exception(
        "unhandled_sqlalchemy_error path=%s method=%s",
        request.url.path,
        request.method,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_envelope(
            type_="server_error",
            message="An internal error occurred. Please try again.",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        ),
    )


async def _unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    # Catch-all for genuine bugs. Same redaction policy as the SQLAlchemy
    # handler: type and traceback go to the log; the wire gets a generic
    # message.
    logger.exception(
        "unhandled_exception path=%s method=%s exc_type=%s",
        request.url.path,
        request.method,
        type(exc).__name__,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_envelope(
            type_="server_error",
            message="An internal error occurred. Please try again.",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        ),
    )


def register_error_handlers(app: FastAPI) -> None:
    """Wire all of the above into the app. Call once from main.py.

    NOTE on RateLimitExceeded: slowapi's `_rate_limit_exceeded_handler`
    is registered separately in main.py because it expects a slowapi
    `Request` and returns a 429 with retry-after headers — re-routing it
    through our envelope would lose those headers. The cost is that 429
    is the one endpoint that doesn't match the envelope shape; the
    frontend can special-case it by status code.
    """
    # Both fastapi.HTTPException and starlette.HTTPException need to be
    # registered explicitly — they're related but not the same class.
    app.add_exception_handler(HTTPException, _http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(SQLAlchemyError, _sqlalchemy_exception_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)

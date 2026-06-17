"""Selects the active WhatsApp provider from settings.

- WHATSAPP_DRY_RUN (or missing credentials) -> DryRunProvider: renders + logs
  but never calls Meta. This is the default, so a misconfigured deploy can
  never accidentally message real customers.
- Otherwise -> MetaCloudProvider with credentials from env.
"""
from __future__ import annotations

import logging

from app.core.config import settings
from app.services.whatsapp.base import SendResult, WhatsAppProvider

logger = logging.getLogger("whatsapp.factory")


class DryRunProvider:
    """Logs the intended message without sending. The job records DRY_RUN."""

    is_dry_run = True

    def __init__(self, reason: str = "dry-run") -> None:
        self._reason = reason

    def send_template(
        self, *, to: str, template: str, language: str, variables: list[str]
    ) -> SendResult:
        logger.info(
            "[%s] would send template=%s lang=%s to=%s vars=%s",
            self._reason,
            template,
            language,
            to,
            variables,
        )
        return SendResult(ok=True, error=self._reason)


def get_provider() -> WhatsAppProvider:
    if settings.WHATSAPP_DRY_RUN:
        return DryRunProvider("dry-run")

    if not (settings.WHATSAPP_PHONE_NUMBER_ID and settings.WHATSAPP_ACCESS_TOKEN):
        logger.warning(
            "WHATSAPP_DRY_RUN is false but credentials are missing — "
            "falling back to dry-run so no send is attempted."
        )
        return DryRunProvider("missing-credentials")

    # Imported lazily so a dry-run / no-httpx environment never imports it.
    from app.services.whatsapp.meta import MetaCloudProvider

    return MetaCloudProvider(
        phone_number_id=settings.WHATSAPP_PHONE_NUMBER_ID,
        access_token=settings.WHATSAPP_ACCESS_TOKEN,
        api_version=settings.WHATSAPP_API_VERSION,
    )

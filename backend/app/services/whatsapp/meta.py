"""Meta WhatsApp Cloud API provider.

Sends an approved template message via the Graph API:
  POST https://graph.facebook.com/{version}/{phone_number_id}/messages

See WHATSAPP_SETUP.md for how to obtain phone_number_id + a permanent token
and how to get the template approved (Utility category).
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.services.whatsapp.base import SendResult

logger = logging.getLogger("whatsapp.meta")


class MetaCloudProvider:
    is_dry_run = False

    def __init__(
        self,
        *,
        phone_number_id: str,
        access_token: str,
        api_version: str = "v21.0",
        timeout: float = 10.0,
    ) -> None:
        self._url = (
            f"https://graph.facebook.com/{api_version}/{phone_number_id}/messages"
        )
        self._headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout

    def send_template(
        self,
        *,
        to: str,
        template: str,
        language: str,
        variables: list[str],
    ) -> SendResult:
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template,
                "language": {"code": language},
                "components": [
                    {
                        "type": "body",
                        "parameters": [
                            {"type": "text", "text": str(v)} for v in variables
                        ],
                    }
                ],
            },
        }

        try:
            resp = httpx.post(
                self._url, headers=self._headers, json=payload, timeout=self._timeout
            )
        except httpx.HTTPError as exc:
            return SendResult(ok=False, error=f"network: {type(exc).__name__}: {exc}")

        if resp.status_code >= 400:
            return SendResult(
                ok=False,
                error=f"http {resp.status_code}: {_short(resp.text)}",
            )

        message_id: Optional[str] = None
        try:
            data = resp.json()
            messages = data.get("messages") or []
            if messages:
                message_id = messages[0].get("id")
        except ValueError:
            pass

        return SendResult(ok=True, message_id=message_id)


def _short(text: str, limit: int = 300) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit] + "…"

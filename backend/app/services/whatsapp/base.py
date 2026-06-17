"""Provider-agnostic contract for sending WhatsApp template messages."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass(frozen=True)
class SendResult:
    """Outcome of a single send attempt."""

    ok: bool
    message_id: Optional[str] = None
    error: Optional[str] = None


class WhatsAppProvider(Protocol):
    """Anything that can send an approved template message to one number."""

    def send_template(
        self,
        *,
        to: str,
        template: str,
        language: str,
        variables: list[str],
    ) -> SendResult:
        ...


def normalize_phone(raw: Optional[str], default_country_code: str = "91") -> Optional[str]:
    """
    Normalise a stored phone to digits-with-country-code (E.164 without the '+'),
    which is what the Meta Cloud API expects in its `to` field.

    Returns None for anything that can't be a real mobile number — the caller
    treats None as "skip, no valid phone".

    Examples (default_country_code="91"):
      "9876543210"      -> "919876543210"
      "+91 98765-43210" -> "919876543210"
      "0919876543210"   -> "919876543210"
      "123"             -> None
    """
    if not raw:
        return None

    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None

    # Drop a single leading trunk zero (e.g. "098765...").
    if digits.startswith("0"):
        digits = digits.lstrip("0")

    cc = default_country_code
    # Bare national number (India mobiles are 10 digits) -> prepend country code.
    if len(digits) == 10:
        digits = cc + digits

    # Must now look like country code + a 10-to-12 digit subscriber number.
    if not (11 <= len(digits) <= 15):
        return None

    return digits

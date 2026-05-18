"""
Centralized PII masking for API responses.
"""
from __future__ import annotations

from typing import Optional


def mask_aadhaar(v: Optional[str]) -> Optional[str]:
    """`123456789012` -> `********9012`. Unexpected length -> fully masked."""
    if not v:
        return v
    if len(v) == 12:
        return f"********{v[-4:]}"
    return "*" * len(v)


def mask_pan(v: Optional[str]) -> Optional[str]:
    """`ABCDE1234F` -> `AB******4F`. Unexpected length -> fully masked."""
    if not v:
        return v
    if len(v) == 10:
        return f"{v[:2]}******{v[-2:]}"
    return "*" * len(v)

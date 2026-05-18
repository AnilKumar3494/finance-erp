"""
Trusted-proxy-aware client IP resolution.

Single source of truth for "what is the real client IP of this request",
used by BOTH the audit logger and the rate limiter so logged IPs and
rate-limit keys are always consistent and equally spoof-resistant.

Threat model
------------
`X-Forwarded-For` is fully client-settable. A proxy/ALB *appends* the
connecting IP to the RIGHT of whatever the client sent — it does not
sanitize the inbound value. So with exactly `TRUSTED_PROXY_HOPS` trusted
proxies in front of the app, the only trustworthy entry is the
`hops`-th from the RIGHT; everything further left is attacker-controlled.

Fail-safe rules:
  - TRUST_FORWARDED_FOR off  -> always use the peer IP (request.client.host).
  - No XFF header            -> peer IP.
  - XFF shorter than `hops`  -> header is malformed/forged; DO NOT trust any
                                of it — fall back to the peer IP.

This deliberately differs from a naive `max(0, len-hops)` clamp, which on
a short/forged header would return the attacker-controlled leftmost value.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Request

from app.core.config import settings

_MAX_IP_LEN = 45  # audit_logs.ip_address is varchar(45) (IPv6-safe)


def resolve_client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None

    peer_ip = (
        request.client.host[:_MAX_IP_LEN]
        if request.client and request.client.host
        else None
    )

    if not settings.TRUST_FORWARDED_FOR:
        return peer_ip

    xff = request.headers.get("x-forwarded-for")
    if not xff:
        return peer_ip

    parts = [p.strip() for p in xff.split(",") if p.strip()]
    hops = settings.TRUSTED_PROXY_HOPS

    # Defense-in-depth: config enforces ge=1 at load, but this is a security
    # primitive and must not depend on a distant validator. A non-positive
    # hop count would make parts[-hops] (e.g. parts[0]) select an
    # attacker-controlled XFF entry — fail closed to the peer IP instead.
    if hops < 1:
        return peer_ip

    # Header has fewer entries than the trusted proxy chain → malformed or
    # forged. Trust none of it; use the spoof-proof peer IP.
    if len(parts) < hops:
        return peer_ip

    # `hops`-th entry from the right = IP the outermost trusted proxy saw.
    return parts[-hops][:_MAX_IP_LEN]

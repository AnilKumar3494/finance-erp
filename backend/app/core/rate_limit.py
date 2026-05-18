"""
Rate limiting setup via slowapi.

Keyed by the *trusted-proxy-resolved* client IP (shared with the audit
logger), NOT slowapi's default get_remote_address. Behind an ALB the raw
peer IP is the load balancer, so get_remote_address would put every user
in one bucket — simultaneously causing false 429s for legitimate users
and collapsing brute-force protection to a single global counter.

`resolve_client_ip` honors X-Forwarded-For only when TRUST_FORWARDED_FOR
is set and only the trusted-hop entry (spoof-resistant). We fall back to
get_remote_address so the key is always a non-empty string for slowapi.

Wire-up:
  - main.py attaches `limiter` to app.state and registers the exception handler.
  - Routes import `limiter` and decorate handlers with `@limiter.limit(...)`.
    Decorated handlers MUST declare `request: Request` as a parameter.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.utils.client_ip import resolve_client_ip


def _client_ip_key(request: Request) -> str:
    return resolve_client_ip(request) or get_remote_address(request)


# Global limiter. Keyed by trusted-proxy-resolved client IP.
limiter = Limiter(key_func=_client_ip_key)

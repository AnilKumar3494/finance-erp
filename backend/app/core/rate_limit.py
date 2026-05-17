"""
Rate limiting setup via slowapi.

Limiter is IP-keyed by default. For routes that need stricter, user-keyed
limits (e.g. login-by-username), pass a custom `key_func` at the decorator.

Wire-up:
  - main.py attaches `limiter` to app.state and registers the exception handler.
  - Routes import `limiter` and decorate handlers with `@limiter.limit(...)`.
    Decorated handlers MUST declare `request: Request` as a parameter.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

# Global limiter. Keyed by client IP.
limiter = Limiter(key_func=get_remote_address)

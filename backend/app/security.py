"""Single-user auth primitives: password check and signed session cookies.

There is one owner and one shared password, so there is no user database and no
Supabase Auth. A successful login sets an HttpOnly cookie holding a signed,
expiring token (``v1.<expiry>.<hmac>``). The signature is an HMAC-SHA256 over
the payload using ``SESSION_SECRET``.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

COOKIE_NAME = "axtra_session"
_TOKEN_VERSION = "v1"


def check_password(candidate: str, expected: str) -> bool:
    """Constant-time password comparison. False when no password is configured."""
    if not expected:
        return False
    return secrets.compare_digest(candidate, expected)


def _sign(payload: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session_token(secret: str, ttl_seconds: int) -> str:
    """Return a signed token that expires ``ttl_seconds`` from now."""
    expiry = int(time.time()) + max(ttl_seconds, 60)
    payload = f"{_TOKEN_VERSION}.{expiry}"
    return f"{payload}.{_sign(payload, secret)}"


def verify_session_token(token: str, secret: str) -> bool:
    """Validate signature and expiry. Returns False on any malformation."""
    if not token or not secret:
        return False
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != _TOKEN_VERSION:
        return False
    payload = f"{parts[0]}.{parts[1]}"
    if not secrets.compare_digest(parts[2], _sign(payload, secret)):
        return False
    try:
        expiry = int(parts[1])
    except ValueError:
        return False
    return time.time() < expiry

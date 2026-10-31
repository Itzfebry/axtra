"""Symmetric encryption for per-user provider API keys.

Keys entered in the UI are stored in the ``provider_keys`` table, never in
plaintext and never returned to the browser. Encryption uses Fernet (AES-128 in
CBC + HMAC) with a key derived from ``APP_ENCRYPTION_KEY`` (falling back to the
session secret in development). Rotating the source secret makes previously
stored keys undecryptable, which is the intended, safe failure mode.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings


def _fernet(settings: Settings) -> Fernet | None:
    secret = (settings.app_encryption_key or settings.session_secret or "").strip()
    if not secret:
        return None
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


class EncryptionUnavailable(RuntimeError):
    """Raised when no encryption secret is configured."""


def encryption_available(settings: Settings) -> bool:
    return _fernet(settings) is not None


def encrypt_secret(settings: Settings, value: str) -> str:
    fernet = _fernet(settings)
    if fernet is None:
        raise EncryptionUnavailable(
            "APP_ENCRYPTION_KEY belum diatur, jadi API key tidak bisa disimpan aman."
        )
    return fernet.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(settings: Settings, token: str) -> str:
    fernet = _fernet(settings)
    if fernet is None:
        raise EncryptionUnavailable("APP_ENCRYPTION_KEY belum diatur.")
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise EncryptionUnavailable(
            "API key tersimpan tidak bisa didekripsi (kunci enkripsi berubah?)."
        ) from exc


def mask_key(value: str) -> str:
    """Show only enough to recognise a key, never the whole thing."""
    value = (value or "").strip()
    if len(value) <= 8:
        return "••••"
    return f"{value[:4]}…{value[-4:]}"

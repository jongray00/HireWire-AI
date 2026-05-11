"""AES-GCM-256 field encryption with versioned wire format.

Wire format:
    version (1 byte = 0x01) || nonce (12 bytes) || ciphertext || tag (16 bytes)
"""
from __future__ import annotations

import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from agent.lib.config import Config

VERSION_BYTE = 0x01
NONCE_LEN = 12
TAG_LEN = 16
MIN_BLOB_LEN = 1 + NONCE_LEN + TAG_LEN  # version + nonce + tag (zero-length plaintext)


class CryptoError(RuntimeError):
    """Raised on decryption failure (tag mismatch, bad version, malformed blob)."""


@lru_cache(maxsize=1)
def _get_aesgcm() -> AESGCM:
    return AESGCM(Config.load().encryption_key_bytes)


def _reset_cache_for_tests() -> None:
    """Test-only: clear the cached AESGCM so a fresh ENCRYPTION_KEY takes effect."""
    _get_aesgcm.cache_clear()


def encrypt(plaintext: bytes | str) -> bytes:
    if isinstance(plaintext, str):
        plaintext = plaintext.encode("utf-8")
    aesgcm = _get_aesgcm()
    nonce = os.urandom(NONCE_LEN)
    ct_with_tag = aesgcm.encrypt(nonce, plaintext, associated_data=None)
    return bytes([VERSION_BYTE]) + nonce + ct_with_tag


def decrypt(blob: bytes) -> bytes:
    if len(blob) < MIN_BLOB_LEN:
        raise CryptoError(f"blob too short ({len(blob)} bytes; min {MIN_BLOB_LEN})")
    version = blob[0]
    if version != VERSION_BYTE:
        raise CryptoError(f"unknown crypto version byte 0x{version:02x}")
    nonce = blob[1 : 1 + NONCE_LEN]
    ct_with_tag = blob[1 + NONCE_LEN :]
    aesgcm = _get_aesgcm()
    try:
        return aesgcm.decrypt(nonce, ct_with_tag, associated_data=None)
    except Exception as exc:
        raise CryptoError("decryption failed (tag mismatch or corrupted ciphertext)") from exc

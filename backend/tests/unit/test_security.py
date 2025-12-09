from jose import jwt
import pytest

from app.core import security
from app.core.config import settings


def test_hash_and_verify_password():
    pw = "CorrectHorseBatteryStaple"
    h = security.hash_password(pw)
    assert isinstance(h, str) and h
    assert security.verify_password(pw, h) is True
    assert security.verify_password("wrong", h) is False


def test_hash_password_too_long_raises():
    # bcrypt has a 72-byte input limit
    long_pw = "a" * 100
    with pytest.raises(ValueError):
        security.hash_password(long_pw)


def test_create_access_token_contains_expected_claims():
    token = security.create_access_token(user_id=42, role="user")
    decoded = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    assert decoded.get("sub") == "42"
    assert decoded.get("role") == "user"
    assert "exp" in decoded and "iat" in decoded

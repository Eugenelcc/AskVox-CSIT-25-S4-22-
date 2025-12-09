#import asyncio
#from typing import Any

import pytest
from fastapi.testclient import TestClient
#from fastapi import HTTPException

from app.main import app
from app.api.deps import get_db, get_current_user
from app.models.users import UserRole


class FakeUser:
    def __init__(self, id=1, email="test@example.com", role=UserRole.user.value, is_active=True):
        self.id = id
        self.email = email
        self.role = role
        self.is_active = is_active
        self.password_hash = "hashed"


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeSession:
    def __init__(self, existing=None):
        # `existing` will be returned from select queries
        self.existing = existing
        self._last_added = None

    async def execute(self, *args, **kwargs):
        return FakeResult(self.existing)

    async def commit(self):
        return None

    async def refresh(self, obj, *args, **kwargs):
        # emulate DB assigning an id on refresh
        if not getattr(obj, "id", None):
            obj.id = 123

    def add(self, obj):
        self._last_added = obj


@pytest.fixture(autouse=True)
def client():
    with TestClient(app) as c:
        yield c


def async_override_get_db_factory(existing=None):
    async def _override_get_db():
        sess = FakeSession(existing=existing)
        yield sess

    return _override_get_db


def test_register_conflict(client):
    # Simulate existing user -> register should return 400
    existing_user = FakeUser()
    app.dependency_overrides[get_db] = async_override_get_db_factory(existing=existing_user)

    resp = client.post("/auth/register", json={"email": "test@example.com", "password": "pw"})
    assert resp.status_code == 400

    app.dependency_overrides.clear()


def test_register_success(monkeypatch, client):
    # No existing user -> should register and return id/email
    app.dependency_overrides[get_db] = async_override_get_db_factory(existing=None)

    resp = client.post("/auth/register", json={"email": "new@example.com", "password": "pw"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "new@example.com"
    assert "id" in data

    app.dependency_overrides.clear()


def test_login_invalid_credentials(client):
    # No user found -> login should return 401
    app.dependency_overrides[get_db] = async_override_get_db_factory(existing=None)
    resp = client.post("/auth/login", json={"email": "xi@example.com", "password": "pw"})
    assert resp.status_code == 401
    app.dependency_overrides.clear()


def test_login_success(monkeypatch, client):
    # Mock verify_password and token creation to make login deterministic
    from app.core import security

    monkeypatch.setattr(security, "verify_password", lambda pw, h: True)
    monkeypatch.setattr(security, "create_access_token", lambda user_id, role: "access-token")
    monkeypatch.setattr(security, "create_refresh_token", lambda: "refresh-token")

    fake_user = FakeUser()
    app.dependency_overrides[get_db] = async_override_get_db_factory(existing=fake_user)

    resp = client.post("/auth/login", json={"email": "test@example.com", "password": "pw"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["access_token"] == "access-token"
    assert data["refresh_token"] == "refresh-token"

    app.dependency_overrides.clear()


def test_me_endpoint_requires_auth(client):
    # No bearer token -> should return 401
    resp = client.get("/me")
    assert resp.status_code == 401


def test_me_endpoint_success(client):
    # Override current user dependency to return a fake user
    async def _fake_current_user():
        return FakeUser(id=5, email="me@example.com")

    app.dependency_overrides[get_current_user] = _fake_current_user
    resp = client.get("/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@example.com"
    app.dependency_overrides.clear()


def test_admin_ping_forbidden_and_allowed(client):
    async def _user():
        return FakeUser(role=UserRole.user.value)

    async def _admin():
        return FakeUser(role=UserRole.admin.value)

    # User role -> forbidden
    app.dependency_overrides[get_current_user] = _user
    resp = client.get("/admin/ping")
    assert resp.status_code == 403

    # Admin role -> allowed
    app.dependency_overrides[get_current_user] = _admin
    resp = client.get("/admin/ping")
    assert resp.status_code == 200
    assert resp.json().get("admin") is True

    app.dependency_overrides.clear()

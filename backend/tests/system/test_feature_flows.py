import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.deps import get_db, get_current_user
from tests.helpers import async_override_get_db_factory, FakeUser


@pytest.fixture(autouse=True)
def client():
    with TestClient(app) as c:
        yield c


def test_otp_send_and_verify(client):
    resp = client.post("/auth/send-otp", json={"email": "u@x.com"})
    assert resp.status_code == 200
    otp = resp.json()["otp"]

    resp2 = client.post("/auth/verify-otp", json={"email": "u@x.com", "otp": otp})
    assert resp2.status_code == 200


def test_change_password_and_delete_account(client):
    fake_user = FakeUser(id=99, email="me@x.com", password_hash="hashed", is_active=True)
    app.dependency_overrides[get_current_user] = lambda: fake_user
    app.dependency_overrides[get_db] = async_override_get_db_factory(existing=fake_user)

    # monkeypatch verify_password to accept current password
    from app.core import security

    orig_verify = security.verify_password
    security.verify_password = lambda pw, h: True

    resp = client.post("/auth/change-password", json={"current_password": "old", "new_password": "new"})
    assert resp.status_code == 200

    resp2 = client.post("/auth/delete-account", json={"confirm": True})
    assert resp2.status_code == 200
    assert fake_user.is_active is False

    # restore
    security.verify_password = orig_verify
    app.dependency_overrides.clear()


def test_payment_add_and_confirm(client):
    fake_user = FakeUser(id=5, email="pay@x.com")
    app.dependency_overrides[get_current_user] = lambda: fake_user

    resp = client.post("/auth/payments/add-card", json={"number": "4242424242424242", "exp_month": 12, "exp_year": 2030, "cvc": "123"})
    assert resp.status_code == 200
    body = resp.json()
    token = body["token"]
    otp = body["otp"]

    resp2 = client.post("/auth/payments/confirm", json={"token": token, "otp": otp})
    assert resp2.status_code == 200

    app.dependency_overrides.clear()


def test_transcribe_and_chat_and_recommendations(client):
    fake_user = FakeUser(id=7, email="chat@x.com")
    app.dependency_overrides[get_current_user] = lambda: fake_user

    # transcribe
    r = client.post("/auth/transcribe", json={"audio": "hello world"})
    assert r.status_code == 200
    assert r.json()["transcript"] == "hello world"

    # chat send twice to build history
    c1 = client.post("/auth/chat/send", json={"text": "learn python"})
    assert c1.status_code == 200
    c2 = client.post("/auth/chat/send", json={"text": "learn testing"})
    assert c2.status_code == 200

    # recommendations should return recent words
    rec = client.get("/auth/recommendations")
    assert rec.status_code == 200
    assert isinstance(rec.json().get("recommendations"), list)

    app.dependency_overrides.clear()

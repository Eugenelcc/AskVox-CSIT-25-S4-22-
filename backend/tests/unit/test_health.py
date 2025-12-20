import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def anyio_backend():
    return "asyncio"
def test_health_endpoint():
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

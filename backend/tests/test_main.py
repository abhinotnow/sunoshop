# Tests the FastAPI health endpoint and environment-backed app configuration.
# Exports the M1-01 health endpoint regression test.
# Depends on pytest, FastAPI's test client, and backend.main.

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

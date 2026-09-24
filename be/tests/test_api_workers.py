from fastapi.testclient import TestClient

from api.app import create_app
from api.envelope import HTTP_STATUS
from domain import ErrorCode, Settings
from tests.conftest import FakeClock

START_ISO = "2027-01-15T08:00:00Z"


def test_register_worker_returns_envelope(client: TestClient, settings: Settings) -> None:
    resp = client.put("/api/workers/w1", json={"name": "alpha", "concurrentLimit": 4})
    assert resp.status_code == 200
    assert resp.json() == {
        "ok": True,
        "data": {
            "id": "w1",
            "name": "alpha",
            "ip": "testclient",
            "concurrentLimit": 4,
            "connectedAt": START_ISO,
            "lastSeenAt": START_ISO,
            "leaseUntil": "2027-01-15T08:00:30Z",
            "leaseMsRemaining": settings.worker_lease_ms,
            "connected": True,
        },
    }


def test_register_worker_validation_error(client: TestClient) -> None:
    resp = client.put("/api/workers/w1", json={"name": "", "concurrentLimit": 0})
    assert resp.status_code == 422
    body = resp.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert len(body["error"]["details"]) == 2


def test_register_worker_rejects_out_of_range_concurrent_limit(client: TestClient) -> None:
    resp = client.put("/api/workers/w1", json={"name": "a", "concurrentLimit": 2**63})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_worker_heartbeat_extends_lease(client: TestClient, clock: FakeClock) -> None:
    client.put("/api/workers/w1", json={"name": "alpha", "concurrentLimit": 1})
    clock.advance(10_000)
    resp = client.post("/api/workers/w1/heartbeat")
    assert resp.status_code == 200
    assert resp.json() == {
        "ok": True,
        "data": {"leaseUntil": "2027-01-15T08:00:40Z", "leaseMsRemaining": 30_000},
    }


def test_worker_heartbeat_updates_ip(
    client: TestClient, settings: Settings, clock: FakeClock
) -> None:
    client.put("/api/workers/w1", json={"name": "alpha", "concurrentLimit": 1})
    with TestClient(create_app(settings, clock), client=("10.0.0.7", 50000)) as other:
        assert other.post("/api/workers/w1/heartbeat").status_code == 200
    assert client.get("/api/workers").json()["data"][0]["ip"] == "10.0.0.7"


def test_worker_heartbeat_unknown_worker(client: TestClient) -> None:
    resp = client.post("/api/workers/ghost/heartbeat")
    assert resp.status_code == 404
    assert resp.json() == {
        "ok": False,
        "error": {
            "code": "WORKER_NOT_FOUND",
            "message": "worker is not registered",
            "details": None,
        },
    }


def test_list_workers_reports_connection(
    client: TestClient, clock: FakeClock, settings: Settings
) -> None:
    client.put("/api/workers/w1", json={"name": "a", "concurrentLimit": 1})
    clock.advance(settings.worker_lease_ms)
    client.put("/api/workers/w2", json={"name": "b", "concurrentLimit": 1})
    data = client.get("/api/workers").json()["data"]
    assert [(w["id"], w["connected"], w["leaseMsRemaining"]) for w in data] == [
        ("w1", False, 0),
        ("w2", True, settings.worker_lease_ms),
    ]


def test_unknown_route_uses_envelope(client: TestClient) -> None:
    resp = client.get("/api/nope")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "ROUTE_NOT_FOUND"


def test_wrong_method_uses_envelope(client: TestClient) -> None:
    resp = client.delete("/api/workers")
    assert resp.status_code == 405
    assert resp.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_unhandled_error_becomes_internal_error(settings: Settings, clock: FakeClock) -> None:
    app = create_app(settings, clock)

    @app.get("/api/boom")
    def boom() -> None:
        raise RuntimeError

    with TestClient(app, raise_server_exceptions=False) as test_client:
        resp = test_client.get("/api/boom")
    assert resp.status_code == 500
    assert resp.json() == {
        "ok": False,
        "error": {"code": "INTERNAL_ERROR", "message": "internal error", "details": None},
    }


def test_every_error_code_has_an_http_status() -> None:
    assert set(HTTP_STATUS) == set(ErrorCode)

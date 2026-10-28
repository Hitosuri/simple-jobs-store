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


def test_list_workers_hides_long_offline_unless_asked(client: TestClient, clock: FakeClock) -> None:
    client.put("/api/workers/old", json={"name": "a", "concurrentLimit": 1})
    clock.advance(25 * 3_600_000)
    client.put("/api/workers/new", json={"name": "b", "concurrentLimit": 1})
    shown = client.get("/api/workers").json()["data"]
    assert [w["id"] for w in shown] == ["new"]
    everyone = client.get("/api/workers?includeOffline=true").json()["data"]
    assert [w["id"] for w in everyone] == ["new", "old"]


def test_list_workers_shows_offline_for_under_a_day(client: TestClient, clock: FakeClock) -> None:
    client.put("/api/workers/w1", json={"name": "a", "concurrentLimit": 1})
    clock.advance(3_600_000 + 30_000)
    assert [w["id"] for w in client.get("/api/workers").json()["data"]] == ["w1"]


def test_delete_connected_worker_is_rejected(client: TestClient) -> None:
    client.put("/api/workers/w1", json={"name": "a", "concurrentLimit": 1})
    resp = client.delete("/api/workers/w1")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "WORKER_CONNECTED"


def test_delete_offline_worker_with_running_job_is_rejected(
    client: TestClient, clock: FakeClock, settings: Settings
) -> None:
    client.put("/api/workers/w1", json={"name": "a", "concurrentLimit": 1})
    client.post("/api/jobs", json={"type": "t", "description": {}, "maxRunMs": 3_600_000})
    client.post("/api/jobs/claim", json={"workerId": "w1", "type": "t"})
    clock.advance(settings.worker_lease_ms + 1)
    resp = client.delete("/api/workers/w1")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "WORKER_BUSY"


def test_delete_offline_idle_worker_and_unknown(
    client: TestClient, clock: FakeClock, settings: Settings
) -> None:
    client.put("/api/workers/w1", json={"name": "a", "concurrentLimit": 1})
    clock.advance(settings.worker_lease_ms + 1)
    assert client.delete("/api/workers/w1").json() == {"ok": True, "data": None}
    assert client.get("/api/workers?includeOffline=true").json()["data"] == []
    assert client.delete("/api/workers/w1").status_code == 404


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

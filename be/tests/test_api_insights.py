from fastapi.testclient import TestClient

from domain import ErrorCode
from tests.conftest import FakeClock

MINUTE = 60_000


def _register(client: TestClient, worker_id: str) -> None:
    body = {"name": worker_id, "concurrentLimit": 1}
    assert client.put(f"/api/workers/{worker_id}", json=body).status_code == 200


def _claim(client: TestClient, worker_id: str) -> int:
    client.post("/api/jobs", json={"type": "a", "description": {}})
    response = client.post("/api/jobs/claim", json={"workerId": worker_id, "type": "a"})
    job_id = response.json()["data"]["job"]["id"]
    assert isinstance(job_id, int)
    return job_id


def test_overview_shape(client: TestClient) -> None:
    _register(client, "w1")
    job_id = _claim(client, "w1")
    client.post("/api/jobs", json={"type": "b", "description": {}})

    data = client.get("/api/overview").json()["data"]

    assert data["counts"] == {
        "pending": 1,
        "running": 1,
        "success": 0,
        "failed": 0,
        "cancelled": 0,
    }
    [load] = data["workers"]
    assert load["worker"]["id"] == "w1"
    assert [(j["id"], j["type"]) for j in load["running"]] == [(job_id, "a")]
    assert load["running"][0]["startedAt"] == "2027-01-15T08:00:00Z"
    assert data["pendingByType"][0]["type"] == "b"
    assert len(data["throughput"]) == 12
    assert data["runP95ByType"] == {}


def test_stats_shape_and_validation(client: TestClient) -> None:
    data = client.get("/api/stats", params={"range": "1h"}).json()["data"]

    assert data["kpis"]["finished"] == {"value": 0, "previous": 0}
    assert data["kpis"]["successRate"] == {"value": None, "previous": None}
    assert len(data["buckets"]) == 12
    assert data["byType"] == []
    assert data["topErrors"] == []
    week = client.get("/api/stats", params={"range": "7d"}).json()["data"]
    assert week["kpis"]["finished"]["previous"] is None
    assert client.get("/api/stats", params={"range": "2d"}).status_code == 422
    assert client.get("/api/stats").status_code == 422


def test_attempts_window(client: TestClient, clock: FakeClock) -> None:
    _register(client, "w1")
    job_id = _claim(client, "w1")
    clock.advance(10 * MINUTE)

    response = client.get(
        "/api/attempts",
        params={
            "from": "2027-01-15T08:05:00Z",
            "to": "2027-01-15T08:15:00Z",
            "worker": "w1",
        },
    )

    assert response.status_code == 200
    [row] = response.json()["data"]
    assert (row["jobId"], row["jobType"], row["workerId"], row["endedAt"]) == (
        job_id,
        "a",
        "w1",
        None,
    )
    assert "leaseToken" not in row


def test_attempts_window_is_validated(client: TestClient) -> None:
    def code(start: str, end: str) -> tuple[int, str]:
        response = client.get("/api/attempts", params={"from": start, "to": end})
        error_code = response.json()["error"]["code"]
        assert isinstance(error_code, str)
        return response.status_code, error_code

    expected = (422, ErrorCode.VALIDATION_ERROR)
    assert code("2027-01-15T08:00:00Z", "2027-01-15T08:00:00Z") == expected
    assert code("2027-01-15T09:00:00Z", "2027-01-15T08:00:00Z") == expected
    assert code("2027-01-15T08:00:00Z", "2027-01-16T08:00:01Z") == expected
    assert client.get("/api/attempts").status_code == 422

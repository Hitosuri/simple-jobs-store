from typing import Any

import pytest
from fastapi.testclient import TestClient

from domain import Settings
from tests.conftest import FakeClock

START_ISO = "2027-01-15T08:00:00Z"


def register(client: TestClient, worker_id: str = "w1") -> None:
    client.put(f"/api/workers/{worker_id}", json={"name": worker_id, "concurrent_limit": 1})


def create(client: TestClient, **fields: Any) -> Any:
    resp = client.post("/api/jobs", json={"type": "t", "description": {"n": 1}, **fields})
    assert resp.status_code == 201
    return resp.json()["data"]


def claim(client: TestClient, worker_id: str = "w1") -> Any:
    resp = client.post("/api/jobs/claim", json={"worker_id": worker_id, "type": "t"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data is not None
    return data


def lease_body(claimed: Any) -> dict[str, Any]:
    return {"worker_id": claimed["job"]["worker_id"], "lease_token": claimed["lease_token"]}


def error_code(resp: Any) -> Any:
    return resp.json()["error"]["code"]


def test_create_job_returns_201_with_defaults(client: TestClient, settings: Settings) -> None:
    job = create(client)
    assert job["status"] == "pending"
    assert job["description"] == {"n": 1}
    assert job["max_attempt"] == settings.default_max_attempt
    assert job["max_run_ms"] == settings.default_max_run_ms
    assert job["priority"] == 0
    assert job["attempt"] == 0
    assert job["worker_id"] is None
    assert job["lease_until"] is None
    assert job["available_at"] == START_ISO
    assert job["result"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"type": "", "description": {}},
        {"type": "t"},
        {"type": "t", "description": {}, "max_attempt": 0},
        {"type": "t", "description": {}, "max_attempt": 101},
        {"type": "t", "description": {}, "max_run_ms": 86_400_001},
        {"type": "t", "description": {}, "priority": 2**31},
    ],
)
def test_create_job_rejects_invalid_input(client: TestClient, body: dict[str, Any]) -> None:
    resp = client.post("/api/jobs", json=body)
    assert resp.status_code == 422
    assert error_code(resp) == "VALIDATION_ERROR"


def test_description_round_trips_any_json(client: TestClient) -> None:
    description = [1, "a", None, {"x": True, "y": [2.5]}]
    job = create(client, description=description)
    assert client.get(f"/api/jobs/{job['id']}").json()["data"]["job"]["description"] == description


def test_get_job_includes_attempts_but_never_the_token(client: TestClient) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    resp = client.get(f"/api/jobs/{claimed['job']['id']}")
    data = resp.json()["data"]
    assert data["job"]["status"] == "running"
    assert data["job"]["worker_id"] == "w1"
    assert [(a["attempt_no"], a["worker_id"], a["outcome"]) for a in data["attempts"]] == [
        (1, "w1", None),
    ]
    assert claimed["lease_token"] not in resp.text


def test_get_unknown_job(client: TestClient) -> None:
    resp = client.get("/api/jobs/999")
    assert resp.status_code == 404
    assert error_code(resp) == "JOB_NOT_FOUND"


def test_list_jobs_filters(client: TestClient) -> None:
    create(client, type="a")
    create(client, type="b")
    assert [j["type"] for j in client.get("/api/jobs?type=a").json()["data"]] == ["a"]
    assert client.get("/api/jobs?status=running").json()["data"] == []
    assert len(client.get("/api/jobs").json()["data"]) == 2
    assert client.get("/api/jobs?limit=0").status_code == 422


def test_claim_returns_job_and_lease(client: TestClient, settings: Settings) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    assert isinstance(claimed["lease_token"], str)
    assert claimed["lease_ms_remaining"] == settings.job_lease_ms
    assert claimed["lease_until"] == "2027-01-15T08:00:30Z"
    assert claimed["deadline_at"] == "2027-01-16T08:00:00Z"
    assert claimed["job"]["status"] == "running"
    assert claimed["job"]["attempt"] == 1


def test_claim_with_no_job_returns_null_data(client: TestClient) -> None:
    register(client)
    resp = client.post("/api/jobs/claim", json={"worker_id": "w1", "type": "t"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "data": None}


def test_claim_with_expired_worker_lease(
    client: TestClient, clock: FakeClock, settings: Settings
) -> None:
    register(client)
    clock.advance(settings.worker_lease_ms)
    create(client)
    resp = client.post("/api/jobs/claim", json={"worker_id": "w1", "type": "t"})
    assert resp.status_code == 409
    assert error_code(resp) == "WORKER_LEASE_EXPIRED"


def test_job_heartbeat_extends_and_rejects_wrong_token(
    client: TestClient, clock: FakeClock, settings: Settings
) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    job_id = claimed["job"]["id"]
    clock.advance(10_000)
    resp = client.post(f"/api/jobs/{job_id}/heartbeat", json=lease_body(claimed))
    assert resp.status_code == 200
    assert resp.json()["data"] == {
        "lease_until": "2027-01-15T08:00:40Z",
        "lease_ms_remaining": settings.job_lease_ms,
        "deadline_at": "2027-01-16T08:00:00Z",
    }
    wrong = client.post(
        f"/api/jobs/{job_id}/heartbeat", json={"worker_id": "w1", "lease_token": "wrong"}
    )
    assert wrong.status_code == 409
    assert error_code(wrong) == "LEASE_REJECTED"


def test_finish_success_and_failed(client: TestClient) -> None:
    register(client)
    create(client)
    create(client)
    first = claim(client)
    done = client.post(
        f"/api/jobs/{first['job']['id']}/finish",
        json={**lease_body(first), "status": "success", "result": {"x": 1}},
    ).json()["data"]
    assert (done["status"], done["result"]) == ("success", {"x": 1})
    second = claim(client)
    failed = client.post(
        f"/api/jobs/{second['job']['id']}/finish",
        json={**lease_body(second), "status": "failed", "error": "boom"},
    ).json()["data"]
    assert (failed["status"], failed["error"]) == ("pending", "boom")


@pytest.mark.parametrize(
    "extra",
    [
        {"status": "failed"},
        {"status": "done"},
    ],
)
def test_finish_rejects_invalid_body(client: TestClient, extra: dict[str, Any]) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    resp = client.post(
        f"/api/jobs/{claimed['job']['id']}/finish", json={**lease_body(claimed), **extra}
    )
    assert resp.status_code == 422
    assert error_code(resp) == "VALIDATION_ERROR"


def test_release_returns_null_and_job_goes_pending(client: TestClient) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    job_id = claimed["job"]["id"]
    resp = client.post(f"/api/jobs/{job_id}/release", json=lease_body(claimed))
    assert resp.json() == {"ok": True, "data": None}
    assert client.get(f"/api/jobs/{job_id}").json()["data"]["job"]["status"] == "pending"


@pytest.mark.parametrize(
    "make_request",
    [
        lambda client: client.get("/api/jobs/9223372036854775808"),
        lambda client: client.post("/api/jobs/9223372036854775808/cancel"),
    ],
)
def test_out_of_range_job_id_returns_422(client: TestClient, make_request: Any) -> None:
    resp = make_request(client)
    assert resp.status_code == 422
    assert error_code(resp) == "VALIDATION_ERROR"


def test_create_job_rejects_non_finite_float_in_description(client: TestClient) -> None:
    resp = client.post(
        "/api/jobs",
        content='{"type":"t","description":{"x":NaN}}',
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 422
    assert error_code(resp) == "VALIDATION_ERROR"
    assert client.get("/api/jobs").json()["data"] == []


def test_finish_success_rejects_non_finite_float_in_result(client: TestClient) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    body = lease_body(claimed)
    resp = client.post(
        f"/api/jobs/{claimed['job']['id']}/finish",
        content=(
            f'{{"worker_id":"{body["worker_id"]}","lease_token":"{body["lease_token"]}",'
            '"status":"success","result":[Infinity]}'
        ),
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 422
    assert error_code(resp) == "VALIDATION_ERROR"
    job = client.get(f"/api/jobs/{claimed['job']['id']}").json()["data"]["job"]
    assert job["status"] == "running"


def test_cancel_running_job_rejects_worker_then_cannot_cancel_again(client: TestClient) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    job_id = claimed["job"]["id"]
    assert client.post(f"/api/jobs/{job_id}/cancel").json()["data"]["status"] == "cancelled"
    heartbeat = client.post(f"/api/jobs/{job_id}/heartbeat", json=lease_body(claimed))
    assert error_code(heartbeat) == "LEASE_REJECTED"
    again = client.post(f"/api/jobs/{job_id}/cancel")
    assert again.status_code == 409
    assert error_code(again) == "JOB_ALREADY_FINISHED"

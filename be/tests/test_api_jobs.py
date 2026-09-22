import json
import sqlite3
from typing import Any

import pytest
from fastapi.testclient import TestClient

import store
from api.schemas import ReportBody
from domain import JobId, Settings
from tests.conftest import FakeClock

START_ISO = "2027-01-15T08:00:00Z"


def register(client: TestClient, worker_id: str = "w1") -> None:
    client.put(f"/api/workers/{worker_id}", json={"name": worker_id, "concurrentLimit": 1})


def create(client: TestClient, **fields: Any) -> Any:
    resp = client.post("/api/jobs", json={"type": "t", "description": {"n": 1}, **fields})
    assert resp.status_code == 201
    return resp.json()["data"]


def claim(client: TestClient, worker_id: str = "w1") -> Any:
    resp = client.post("/api/jobs/claim", json={"workerId": worker_id, "type": "t"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data is not None
    return data


def lease_body(claimed: Any) -> dict[str, Any]:
    return {"workerId": claimed["job"]["workerId"], "leaseToken": claimed["leaseToken"]}


def error_code(resp: Any) -> Any:
    return resp.json()["error"]["code"]


def test_create_job_returns_201_with_defaults(client: TestClient, settings: Settings) -> None:
    job = create(client)
    assert job["status"] == "pending"
    assert job["description"] == {"n": 1}
    assert job["maxAttempt"] == settings.default_max_attempt
    assert job["maxRunMs"] == settings.default_max_run_ms
    assert job["priority"] == 0
    assert job["attempt"] == 0
    assert job["workerId"] is None
    assert job["leaseUntil"] is None
    assert job["availableAt"] == START_ISO
    assert job["result"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"type": "", "description": {}},
        {"type": "t"},
        {"type": "t", "description": {}, "maxAttempt": 0},
        {"type": "t", "description": {}, "maxAttempt": 101},
        {"type": "t", "description": {}, "maxRunMs": 86_400_001},
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
    assert data["job"]["workerId"] == "w1"
    assert [(a["attemptNo"], a["workerId"], a["outcome"]) for a in data["attempts"]] == [
        (1, "w1", None),
    ]
    assert claimed["leaseToken"] not in resp.text


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
    assert isinstance(claimed["leaseToken"], str)
    assert claimed["leaseMsRemaining"] == settings.job_lease_ms
    assert claimed["leaseUntil"] == "2027-01-15T08:00:30Z"
    assert claimed["deadlineAt"] == "2027-01-16T08:00:00Z"
    assert claimed["job"]["status"] == "running"
    assert claimed["job"]["attempt"] == 1


def test_claim_with_no_job_returns_null_data(client: TestClient) -> None:
    register(client)
    resp = client.post("/api/jobs/claim", json={"workerId": "w1", "type": "t"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "data": None}


def test_claim_with_expired_worker_lease(
    client: TestClient, clock: FakeClock, settings: Settings
) -> None:
    register(client)
    clock.advance(settings.worker_lease_ms)
    create(client)
    resp = client.post("/api/jobs/claim", json={"workerId": "w1", "type": "t"})
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
        "leaseUntil": "2027-01-15T08:00:40Z",
        "leaseMsRemaining": settings.job_lease_ms,
        "deadlineAt": "2027-01-16T08:00:00Z",
        "progressAccepted": None,
    }
    wrong = client.post(
        f"/api/jobs/{job_id}/heartbeat", json={"workerId": "w1", "leaseToken": "wrong"}
    )
    assert wrong.status_code == 409
    assert error_code(wrong) == "LEASE_REJECTED"


def send_progress(client: TestClient, claimed: Any, progress: Any) -> Any:
    job_id = claimed["job"]["id"]
    resp = client.post(
        f"/api/jobs/{job_id}/heartbeat", json={**lease_body(claimed), "progress": progress}
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["progressAccepted"] is True
    return client.get(f"/api/jobs/{job_id}").json()["data"]["job"]["progress"]


def sent_step(**fields: Any) -> dict[str, Any]:
    return {"id": "a", "status": "running", **fields}


def shown_step(**fields: Any) -> dict[str, Any]:
    return {
        "id": "a",
        "status": "running",
        "current": None,
        "total": None,
        "percent": None,
        "message": None,
        **fields,
    }


@pytest.mark.parametrize(
    ("sent", "shown"),
    [
        (sent_step(), shown_step()),
        (sent_step(current=40, total=100), shown_step(current=40, total=100, percent=40.0)),
        (sent_step(current=1234), shown_step(current=1234)),
        (sent_step(percent=37.5), shown_step(percent=37.5)),
        (sent_step(message="resizing"), shown_step(message="resizing")),
        (
            sent_step(current=5, total=10, percent=70, message="m"),
            shown_step(current=5, total=10, percent=70.0, message="m"),
        ),
        (sent_step(current=150, total=100), shown_step(current=150, total=100, percent=100.0)),
        (sent_step(id="x" * 32, status="skipped"), shown_step(id="x" * 32, status="skipped")),
    ],
)
def test_job_heartbeat_progress_step_is_shown_with_derived_percent(
    client: TestClient, sent: Any, shown: Any
) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    assert claimed["job"]["progress"] is None
    assert send_progress(client, claimed, [sent]) == [shown]


def test_job_heartbeat_progress_steps_keep_first_seen_order(client: TestClient) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    send_progress(client, claimed, [sent_step(id="a"), sent_step(id="b", status="pending")])
    shown = send_progress(client, claimed, [sent_step(id="c"), sent_step(id="b", status="done")])
    assert [(s["id"], s["status"]) for s in shown] == [
        ("a", "running"),
        ("b", "done"),
        ("c", "running"),
    ]


@pytest.mark.parametrize(
    "bad",
    [
        [],
        [{}],
        [{"id": "a"}],
        [sent_step(status="unknown")],
        [sent_step(id="")],
        [sent_step(id="x" * 33)],
        [sent_step(id=5)],
        [sent_step(), sent_step()],
        [sent_step(total=10)],
        [sent_step(current=-1)],
        [sent_step(current=1, total=0)],
        [sent_step(percent=-0.1)],
        [sent_step(percent=100.5)],
        [sent_step(percent=float("nan"))],
        [sent_step(unknown=2)],
        [sent_step(message=5)],
        [sent_step(id=f"s{i}") for i in range(101)],
        sent_step(),
        "half",
    ],
)
def test_job_heartbeat_with_invalid_progress_extends_lease_but_drops_progress(
    client: TestClient, clock: FakeClock, settings: Settings, bad: Any
) -> None:
    register(client)
    create(client)
    claimed = claim(client)
    kept = send_progress(client, claimed, [sent_step(current=1)])
    clock.advance(10_000)
    job_id = claimed["job"]["id"]
    # httpx refuses to encode NaN, so the body is serialized by hand.
    resp = client.post(
        f"/api/jobs/{job_id}/heartbeat",
        content=json.dumps({**lease_body(claimed), "progress": bad}),
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["leaseMsRemaining"] == settings.job_lease_ms
    assert resp.json()["data"]["progressAccepted"] is False
    assert client.get(f"/api/jobs/{job_id}").json()["data"]["job"]["progress"] == kept


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
            f'{{"workerId":"{body["workerId"]}","leaseToken":"{body["leaseToken"]}",'
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


HOOK = {"type": "callback", "config": {"url": "https://p.example/hook"}}


def test_create_job_with_reports_round_trips(client: TestClient) -> None:
    job = create(client, reports=[HOOK, HOOK])
    stored = client.get(f"/api/jobs/{job['id']}").json()["data"]["job"]
    for view in (job, stored):
        assert view["reports"] == [HOOK, HOOK]
        assert view["reportStatus"] is None
        assert (view["reportRound"], view["reportCursor"]) == (0, 0)
        assert view["reportNextAt"] is None
        assert view["reportError"] is None
    assert create(client)["reports"] is None


def test_finished_job_shows_pending_report(client: TestClient) -> None:
    register(client)
    create(client, reports=[HOOK])
    claimed = claim(client)
    done = client.post(
        f"/api/jobs/{claimed['job']['id']}/finish",
        json={"status": "success", **lease_body(claimed)},
    ).json()["data"]
    assert done["reportStatus"] == "pending"
    assert done["reportNextAt"] == START_ISO


@pytest.mark.parametrize(
    "reports",
    [
        [],
        [{"type": "email", "config": {"url": "https://p.example/hook"}}],
        [{"type": "callback", "config": {"url": "ftp://p.example/hook"}}],
        [{"type": "callback", "config": {"url": "not a url"}}],
        [{"type": "callback"}],
        [HOOK] * 11,
    ],
)
def test_create_job_rejects_invalid_reports(client: TestClient, reports: Any) -> None:
    resp = client.post("/api/jobs", json={"type": "t", "description": {}, "reports": reports})
    assert resp.status_code == 422
    assert error_code(resp) == "VALIDATION_ERROR"


def test_report_body_is_camel_case_with_iso_times(
    client: TestClient, conn: sqlite3.Connection
) -> None:
    register(client)
    create(client, reports=[HOOK], maxAttempt=1)
    claimed = claim(client)
    client.post(
        f"/api/jobs/{claimed['job']['id']}/finish",
        json={"status": "failed", "error": "boom", **lease_body(claimed)},
    )
    job, _ = store.get_job(conn, job_id=JobId(claimed["job"]["id"]))
    assert ReportBody.build(job).model_dump(mode="json", by_alias=True) == {
        "id": claimed["job"]["id"],
        "type": "t",
        "status": "failed",
        "startedAt": START_ISO,
        "finishedAt": START_ISO,
        "result": None,
        "error": "boom",
        "errorDetail": None,
    }

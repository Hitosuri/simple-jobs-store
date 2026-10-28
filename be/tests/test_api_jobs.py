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


def test_job_out_has_attempts_used_and_requeued_at(client: TestClient) -> None:
    job = create(client)
    assert job["attemptsUsed"] == 0
    assert job["requeuedAt"] is None
    register(client)
    claimed = claim(client)
    assert claimed["job"]["attemptsUsed"] == 0
    assert client.get(f"/api/jobs/{job['id']}").json()["data"]["job"]["attemptsUsed"] == 0


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
    create(client, type="c")
    assert [j["type"] for j in client.get("/api/jobs?type=a").json()["data"]["items"]] == ["a"]
    both = client.get("/api/jobs?type=a&type=b").json()["data"]
    assert sorted(j["type"] for j in both["items"]) == ["a", "b"]
    assert both["total"] == 2
    counts = client.get("/api/jobs/counts?type=a&type=b").json()["data"]
    assert counts["pending"] == 2
    assert client.get("/api/jobs?status=running").json()["data"]["items"] == []
    assert len(client.get("/api/jobs").json()["data"]["items"]) == 3


def test_list_jobs_returns_a_page(client: TestClient) -> None:
    ids = [create(client)["id"] for _ in range(3)]
    data = client.get("/api/jobs?page=2&pageSize=2").json()["data"]
    assert [j["id"] for j in data["items"]] == [ids[0]]
    assert (data["page"], data["pageSize"], data["total"]) == (2, 2, 3)
    default = client.get("/api/jobs").json()["data"]
    assert (default["page"], default["pageSize"], default["total"]) == (1, 100, 3)


@pytest.mark.parametrize("query", ["page=0", "pageSize=0", "pageSize=1001", f"page={2**31}"])
def test_list_jobs_rejects_bad_paging(client: TestClient, query: str) -> None:
    resp = client.get(f"/api/jobs?{query}")
    assert resp.status_code == 422
    assert error_code(resp) == "VALIDATION_ERROR"


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
    assert client.get("/api/jobs").json()["data"]["items"] == []


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


def test_api_retry_returns_job_and_409_code(client: TestClient) -> None:
    job_id = create(client)["id"]
    assert client.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    retried = client.post(f"/api/jobs/{job_id}/retry")
    assert retried.status_code == 200
    assert retried.json()["data"]["status"] == "pending"
    again = client.post(f"/api/jobs/{job_id}/retry")
    assert again.status_code == 409
    assert error_code(again) == "JOB_NOT_RETRYABLE"


def test_api_patch_priority_and_409_when_not_pending(client: TestClient) -> None:
    job_id = create(client)["id"]
    patched = client.patch(f"/api/jobs/{job_id}", json={"priority": 5})
    assert patched.status_code == 200
    assert patched.json()["data"]["priority"] == 5
    client.post(f"/api/jobs/{job_id}/cancel")
    again = client.patch(f"/api/jobs/{job_id}", json={"priority": 6})
    assert again.status_code == 409
    assert error_code(again) == "JOB_NOT_PENDING"


def test_api_patch_priority_out_of_range_is_422(client: TestClient) -> None:
    job_id = create(client)["id"]
    assert client.patch(f"/api/jobs/{job_id}", json={"priority": 2**31}).status_code == 422


def test_api_delete_finished_job_then_404_and_409_when_unfinished(client: TestClient) -> None:
    job_id = create(client)["id"]
    blocked = client.delete(f"/api/jobs/{job_id}")
    assert blocked.status_code == 409
    assert error_code(blocked) == "JOB_NOT_FINISHED"
    client.post(f"/api/jobs/{job_id}/cancel")
    deleted = client.delete(f"/api/jobs/{job_id}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] is None
    missing = client.get(f"/api/jobs/{job_id}")
    assert missing.status_code == 404
    assert error_code(missing) == "JOB_NOT_FOUND"


def test_api_bulk_retry_reports_skipped_ids_with_codes(client: TestClient) -> None:
    register(client)
    failed_id = create(client, maxAttempt=1)["id"]
    failed = claim(client)
    client.post(
        f"/api/jobs/{failed_id}/finish",
        json={**lease_body(failed), "status": "failed", "error": "boom"},
    )
    running_id = create(client)["id"]
    claim(client)
    resp = client.post(
        "/api/jobs/bulk",
        json={"action": "retry", "ids": [failed_id, failed_id, 999999, running_id]},
    )
    assert resp.status_code == 200
    assert resp.json()["data"] == {
        "done": [failed_id],
        "skipped": [
            {"id": 999999, "code": "JOB_NOT_FOUND"},
            {"id": running_id, "code": "JOB_NOT_RETRYABLE"},
        ],
    }


def test_api_bulk_priority_cancel_delete(client: TestClient) -> None:
    ids = [create(client)["id"] for _ in range(2)]
    resp = client.post("/api/jobs/bulk", json={"action": "priority", "ids": ids, "priority": 7})
    assert resp.json()["data"] == {"done": ids, "skipped": []}
    assert client.get(f"/api/jobs/{ids[0]}").json()["data"]["job"]["priority"] == 7
    resp = client.post("/api/jobs/bulk", json={"action": "cancel", "ids": ids})
    assert resp.json()["data"] == {"done": ids, "skipped": []}
    for job_id in ids:
        assert client.get(f"/api/jobs/{job_id}").json()["data"]["job"]["status"] == "cancelled"
    resp = client.post("/api/jobs/bulk", json={"action": "delete", "ids": ids})
    assert resp.json()["data"] == {"done": ids, "skipped": []}


@pytest.mark.parametrize(
    "body",
    [
        {"action": "priority", "ids": [1]},
        {"action": "cancel", "ids": list(range(1, 1002))},
        {"action": "cancel", "ids": []},
        {"action": "cancel", "ids": [2**63]},
        {"action": "cancel", "ids": [0]},
        {"action": "nope", "ids": [1]},
    ],
)
def test_api_bulk_rejects_invalid_body(client: TestClient, body: dict[str, Any]) -> None:
    assert client.post("/api/jobs/bulk", json=body).status_code == 422


def ids(client: TestClient, query: str) -> list[int]:
    resp = client.get(f"/api/jobs?{query}")
    assert resp.status_code == 200
    return [j["id"] for j in resp.json()["data"]["items"]]


def test_list_jobs_repeated_status(client: TestClient) -> None:
    register(client)
    first = create(client)
    second = create(client)
    third = create(client)
    claim(client)
    client.post(f"/api/jobs/{third['id']}/cancel")
    client.post(f"/api/jobs/{second['id']}/cancel")
    assert ids(client, "status=cancelled&status=running") == [
        third["id"],
        second["id"],
        first["id"],
    ]
    assert ids(client, "status=cancelled") == [third["id"], second["id"]]


def test_list_jobs_worker_filter(client: TestClient) -> None:
    register(client, "w1")
    register(client, "w2")
    job = create(client)
    create(client)
    claim(client, "w1")
    assert ids(client, "worker=w1") == [job["id"]]
    assert ids(client, "worker=w2") == []


def test_list_jobs_q_matches_description_literally(client: TestClient) -> None:
    pct = create(client, description={"p": "50%"})
    create(client, description={"p": "500"})
    under = create(client, description={"p": "a_b"})
    create(client, description={"p": "axb"})
    assert ids(client, "q=50%25") == [pct["id"]]
    assert ids(client, "q=a_b") == [under["id"]]


def test_list_jobs_q_digits_also_matches_id(client: TestClient) -> None:
    jobs = [create(client) for _ in range(12)]
    assert ids(client, "q=12") == [jobs[11]["id"]]


def test_list_jobs_q_huge_digit_string_does_not_crash(client: TestClient) -> None:
    create(client)
    assert ids(client, f"q={'9' * 5000}") == []


def test_list_jobs_created_range(client: TestClient, clock: FakeClock) -> None:
    a = create(client)
    clock.advance(60_000)
    b = create(client)
    assert ids(client, "createdFrom=2027-01-15T08:00:30Z") == [b["id"]]
    assert ids(client, "createdTo=2027-01-15T08:00:30Z") == [a["id"]]


def test_list_jobs_sorts(client: TestClient) -> None:
    high = create(client, priority=9)
    low = create(client, priority=1)
    assert ids(client, "sort=oldest") == [high["id"], low["id"]]
    assert ids(client, "sort=priority") == [high["id"], low["id"]]
    assert ids(client, "sort=newest") == [low["id"], high["id"]]


def test_list_jobs_sort_running_longest(client: TestClient, clock: FakeClock) -> None:
    register(client, "w1")
    register(client, "w2")
    first = create(client)
    second = create(client)
    claim(client, "w1")
    clock.advance(1_000)
    claim(client, "w2")
    assert ids(client, "status=running&sort=running_longest") == [first["id"], second["id"]]


def test_list_jobs_rejects_bad_sort(client: TestClient) -> None:
    assert client.get("/api/jobs?sort=nope").status_code == 422


def test_job_counts_respect_type_and_ignore_status(client: TestClient) -> None:
    register(client)
    create(client, type="t")
    create(client, type="x")
    claim(client)
    data = client.get("/api/jobs/counts?type=t&status=failed").json()["data"]
    assert data == {"pending": 0, "running": 1, "success": 0, "failed": 0, "cancelled": 0}


def test_last_worker_id_after_attempt_and_null_when_never_claimed(client: TestClient) -> None:
    register(client)
    assert create(client)["lastWorkerId"] is None
    job_id = claim(client)["job"]["id"]
    assert client.get(f"/api/jobs/{job_id}").json()["data"]["job"]["lastWorkerId"] == "w1"

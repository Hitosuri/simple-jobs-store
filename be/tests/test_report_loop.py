import json
import sqlite3
import time
from collections.abc import Iterator
from dataclasses import replace

import httpx2
import pytest
from fastapi.testclient import TestClient
from pydantic import JsonValue

import reports
from api.app import _report_once, create_app
from domain import ReportMethod, ReportStatus, Settings, SuccessReport
from tests.conftest import FakeClock
from tests.test_store import HOOKS, add_job, add_worker, claim, finish, report_of


@pytest.fixture
def sent() -> list[tuple[str, JsonValue]]:
    return []


@pytest.fixture
def http(sent: list[tuple[str, JsonValue]]) -> Iterator[httpx2.Client]:
    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append((request.url.path, json.loads(request.content)))
        return httpx2.Response(500 if request.url.path == "/primary" else 200)

    with httpx2.Client(transport=httpx2.MockTransport(handler)) as client:
        yield client


def test_report_once_falls_back_to_backup_after_backoff(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    http: httpx2.Client,
    sent: list[tuple[str, JsonValue]],
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, reports=HOOKS)
    claimed = claim(conn, clock, settings, wid)
    finish(conn, clock, settings, claimed, SuccessReport(result={"ok": True}))

    _report_once(settings, clock, http)
    assert [path for path, _ in sent] == ["/primary"]
    _report_once(settings, clock, http)
    assert len(sent) == 1
    clock.advance(settings.report_backoff_base_ms)
    _report_once(settings, clock, http)

    assert [path for path, _ in sent] == ["/primary", "/backup"]
    assert sent[1][1] == {
        "id": claimed.job.id,
        "status": "success",
        "startedAt": "2027-01-15T08:00:00Z",
        "finishedAt": "2027-01-15T08:00:00Z",
        "result": {"ok": True},
        "error": None,
        "errorDetail": None,
    }
    assert report_of(conn, claimed.job.id).status is ReportStatus.SUCCESS


def test_background_reporter_delivers_finished_job(
    settings: Settings, clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    delivered: list[JsonValue] = []

    def fake_send(_client: httpx2.Client, _method: ReportMethod, body: JsonValue) -> None:
        delivered.append(body)

    monkeypatch.setattr(reports, "send", fake_send)
    fast = replace(settings, cleanup_interval_ms=20)
    hook = {"type": "callback", "config": {"url": "https://p.example/hook"}}
    with TestClient(create_app(fast, clock)) as client:
        client.put("/api/workers/w1", json={"name": "w1", "concurrentLimit": 1})
        client.post("/api/jobs", json={"type": "t", "description": {}, "reports": [hook]})
        claimed = client.post("/api/jobs/claim", json={"workerId": "w1", "type": "t"}).json()
        job_id = claimed["data"]["job"]["id"]
        client.post(
            f"/api/jobs/{job_id}/finish",
            json={
                "status": "success",
                "workerId": "w1",
                "leaseToken": claimed["data"]["leaseToken"],
            },
        )
        give_up_at = time.monotonic() + 5
        report_status = "pending"
        while report_status != "success" and time.monotonic() < give_up_at:
            time.sleep(0.05)
            job = client.get(f"/api/jobs/{job_id}").json()["data"]["job"]
            report_status = job["reportStatus"]
    assert report_status == "success"
    assert len(delivered) == 1

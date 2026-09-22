import logging

import pytest
from fastapi.testclient import TestClient

from api.app import PollingAccessFilter
from tests.test_api_jobs import claim, create, register


def access_record(method: str, path: str, status: int) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("10.0.0.1:1234", method, path, "1.1", status),
        None,
    )


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/jobs/claim"),
        ("POST", "/api/jobs/42/heartbeat"),
        ("POST", "/api/workers/0e187f74-7a23-4960-9469-3dbc586b736b/heartbeat"),
        ("GET", "/api/workers"),
        ("GET", "/api/workers?limit=5"),
    ],
)
def test_successful_polling_is_dropped(method: str, path: str) -> None:
    assert not PollingAccessFilter().filter(access_record(method, path, 200))


@pytest.mark.parametrize(
    ("method", "path", "status"),
    [
        ("POST", "/api/jobs/claim", 422),
        ("POST", "/api/jobs/42/heartbeat", 409),
        ("POST", "/api/jobs", 201),
        ("POST", "/api/jobs/42/finish", 200),
        ("GET", "/api/workers/w1", 200),
        ("PUT", "/api/workers/w1", 200),
    ],
)
def test_other_requests_and_polling_errors_are_kept(method: str, path: str, status: int) -> None:
    assert PollingAccessFilter().filter(access_record(method, path, status))


def test_claim_logs_claimed_job(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    register(client)
    job = create(client)
    with caplog.at_level(logging.INFO, logger="api.jobs"):
        claim(client)
    assert f"job {job['id']} claimed by worker w1" in caplog.messages


def test_empty_claim_logs_nothing(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    register(client)
    with caplog.at_level(logging.INFO, logger="api.jobs"):
        client.post("/api/jobs/claim", json={"workerId": "w1", "type": "t"})
    assert not [r for r in caplog.records if r.name == "api.jobs"]

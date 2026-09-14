import time
from dataclasses import replace

from fastapi.testclient import TestClient

from api.app import create_app
from domain import Settings
from tests.conftest import FakeClock


def test_background_cleaner_revokes_expired_leases(settings: Settings, clock: FakeClock) -> None:
    fast = replace(settings, cleanup_interval_ms=20)
    with TestClient(create_app(fast, clock)) as client:
        client.put("/api/workers/w1", json={"name": "w1", "concurrent_limit": 1})
        created = client.post("/api/jobs", json={"type": "t", "description": {}})
        job_id = created.json()["data"]["id"]
        client.post("/api/jobs/claim", json={"worker_id": "w1", "type": "t"})
        clock.advance(fast.job_lease_ms)
        give_up_at = time.monotonic() + 5
        status = "running"
        while status == "running" and time.monotonic() < give_up_at:
            time.sleep(0.05)
            status = client.get(f"/api/jobs/{job_id}").json()["data"]["job"]["status"]
    assert status == "pending"

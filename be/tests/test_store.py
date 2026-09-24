import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier

import pytest

import store
from db import connect
from domain import (
    MAX_PROGRESS_STEPS,
    AttemptOutcome,
    CallbackMethod,
    Claim,
    EpochMs,
    FailureReport,
    Job,
    JobAlreadyFinishedError,
    JobId,
    JobNotFoundError,
    JobStatus,
    Lease,
    LeaseRejectedError,
    LeaseToken,
    ProgressStep,
    Report,
    ReportMethod,
    ReportStatus,
    ReportTask,
    Settings,
    StepStatus,
    SuccessReport,
    WorkerId,
    WorkerLeaseExpiredError,
    WorkerNotFoundError,
)
from tests.conftest import FakeClock


def add_worker(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, worker_id: str = "w1"
) -> WorkerId:
    wid = WorkerId(worker_id)
    store.register_worker(
        conn,
        now=clock(),
        settings=settings,
        worker_id=wid,
        name=f"name-{worker_id}",
        ip="127.0.0.1",
        concurrent_limit=2,
    )
    return wid


def add_job(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    *,
    job_type: str = "t",
    priority: int = 0,
    max_attempt: int | None = None,
    max_run_ms: int | None = None,
    reports: list[ReportMethod] | None = None,
) -> Job:
    return store.create_job(
        conn,
        now=clock(),
        settings=settings,
        job_type=job_type,
        description={"n": 1},
        max_attempt=max_attempt,
        max_run_ms=max_run_ms,
        priority=priority,
        reports=reports,
    )


def test_register_creates_worker_with_lease(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    worker = store.register_worker(
        conn,
        now=clock(),
        settings=settings,
        worker_id=WorkerId("w1"),
        name="alpha",
        ip="10.0.0.1",
        concurrent_limit=4,
    )
    assert worker.name == "alpha"
    assert worker.ip == "10.0.0.1"
    assert worker.concurrent_limit == 4
    assert worker.connected_at == clock.now
    assert worker.lease_until == clock.now + settings.worker_lease_ms


def test_register_existing_worker_updates_info(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    add_worker(conn, clock, settings)
    clock.advance(5_000)
    worker = store.register_worker(
        conn,
        now=clock(),
        settings=settings,
        worker_id=WorkerId("w1"),
        name="renamed",
        ip="10.0.0.2",
        concurrent_limit=8,
    )
    assert (worker.name, worker.ip, worker.concurrent_limit) == ("renamed", "10.0.0.2", 8)
    assert worker.connected_at == clock.now
    assert len(store.list_workers(conn)) == 1


def test_heartbeat_extends_worker_lease(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    add_worker(conn, clock, settings)
    connected_at = clock.now
    clock.advance(10_000)
    worker = store.heartbeat_worker(
        conn, now=clock(), settings=settings, worker_id=WorkerId("w1"), ip="10.0.0.9"
    )
    assert worker.last_seen_at == clock.now
    assert worker.lease_until == clock.now + settings.worker_lease_ms
    assert worker.connected_at == connected_at
    assert worker.ip == "10.0.0.9"


def test_heartbeat_unknown_worker_raises(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    with pytest.raises(WorkerNotFoundError):
        store.heartbeat_worker(
            conn, now=clock(), settings=settings, worker_id=WorkerId("nope"), ip="10.0.0.9"
        )


def test_create_job_applies_defaults(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = store.create_job(
        conn,
        now=clock(),
        settings=settings,
        job_type="email",
        description={"to": ["a@b.c"], "retry": True, "n": None},
        max_attempt=None,
        max_run_ms=None,
        priority=0,
    )
    assert job.status is JobStatus.PENDING
    assert job.available_at == clock.now
    assert job.max_attempt == settings.default_max_attempt
    assert job.max_run_ms == settings.default_max_run_ms
    assert job.description == {"to": ["a@b.c"], "retry": True, "n": None}
    assert job.lease is None
    assert job.attempt == 0


def test_create_job_keeps_explicit_values(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = add_job(conn, clock, settings, priority=7, max_attempt=5, max_run_ms=1_000)
    assert (job.priority, job.max_attempt, job.max_run_ms) == (7, 5, 1_000)


def test_get_job_returns_job_and_attempts(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    created = add_job(conn, clock, settings)
    job, attempts = store.get_job(conn, job_id=created.id)
    assert job == created
    assert attempts == []


def test_get_unknown_job_raises(conn: sqlite3.Connection) -> None:
    with pytest.raises(JobNotFoundError):
        store.get_job(conn, job_id=JobId(999))


def test_list_jobs_filters_and_orders_newest_first(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    first = add_job(conn, clock, settings, job_type="a")
    second = add_job(conn, clock, settings, job_type="b")
    third = add_job(conn, clock, settings, job_type="a")
    jobs, total = store.list_jobs(conn, status=None, job_type=None, limit=10, offset=0)
    assert [j.id for j in jobs] == [third.id, second.id, first.id]
    assert total == 3
    jobs, total = store.list_jobs(conn, status=None, job_type="a", limit=10, offset=0)
    assert [j.id for j in jobs] == [third.id, first.id]
    assert total == 2
    assert store.list_jobs(conn, status=JobStatus.RUNNING, job_type=None, limit=10, offset=0) == (
        [],
        0,
    )


def test_list_jobs_pages_with_offset_and_counts_all_matches(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    ids = [add_job(conn, clock, settings).id for _ in range(5)]
    jobs, total = store.list_jobs(conn, status=None, job_type=None, limit=2, offset=2)
    assert [j.id for j in jobs] == [ids[2], ids[1]]
    assert total == 5
    assert store.list_jobs(conn, status=None, job_type=None, limit=2, offset=10) == ([], 5)


def claim(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    worker_id: WorkerId,
    job_type: str = "t",
) -> Claim:
    result = store.claim_job(
        conn, now=clock(), settings=settings, worker_id=worker_id, job_type=job_type
    )
    assert result is not None
    return result


def test_claim_marks_job_running_and_opens_attempt(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    created = add_job(conn, clock, settings, max_run_ms=60_000)
    claimed = claim(conn, clock, settings, wid)
    assert claimed.job.id == created.id
    assert claimed.job.status is JobStatus.RUNNING
    assert claimed.job.attempt == 1
    assert claimed.job.started_at == clock.now
    assert claimed.job.lease == claimed.lease
    assert claimed.lease.worker_id == wid
    assert claimed.lease.until == clock.now + settings.job_lease_ms
    assert claimed.lease.deadline_at == clock.now + 60_000
    _, attempts = store.get_job(conn, job_id=created.id)
    assert len(attempts) == 1
    assert attempts[0].attempt_no == 1
    assert attempts[0].lease_token == claimed.lease.token
    assert attempts[0].outcome is None


def test_claim_lease_is_capped_by_deadline(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_run_ms=10_000)
    claimed = claim(conn, clock, settings, wid)
    assert claimed.lease.until == claimed.lease.deadline_at == clock.now + 10_000


def test_claim_returns_none_when_nothing_is_available(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, job_type="other")
    future = add_job(conn, clock, settings)
    conn.execute("UPDATE jobs SET available_at = ? WHERE id = ?", (clock.now + 1, future.id))
    assert (
        store.claim_job(conn, now=clock(), settings=settings, worker_id=wid, job_type="t") is None
    )


def test_claim_orders_by_priority_then_available_at_then_id(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    low = add_job(conn, clock, settings, priority=0)
    high = add_job(conn, clock, settings, priority=5)
    low_same_time = add_job(conn, clock, settings, priority=0)
    clock.advance(1)
    high_later = add_job(conn, clock, settings, priority=5)
    order = [claim(conn, clock, settings, wid).job.id for _ in range(4)]
    assert order == [high.id, high_later.id, low.id, low_same_time.id]


def test_claim_unknown_worker_raises(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    add_job(conn, clock, settings)
    with pytest.raises(WorkerNotFoundError):
        store.claim_job(
            conn, now=clock(), settings=settings, worker_id=WorkerId("ghost"), job_type="t"
        )


def test_claim_with_expired_worker_lease_raises(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    clock.advance(settings.worker_lease_ms)
    with pytest.raises(WorkerLeaseExpiredError):
        store.claim_job(conn, now=clock(), settings=settings, worker_id=wid, job_type="t")


def test_concurrent_claims_never_share_a_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    workers = [add_worker(conn, clock, settings, f"w{i}") for i in range(8)]
    for _ in range(5):
        add_job(conn, clock, settings)
    barrier = Barrier(len(workers))

    def run(worker_id: WorkerId) -> JobId | None:
        own = connect(settings.db_path)
        try:
            barrier.wait()
            result = store.claim_job(
                own, now=clock(), settings=settings, worker_id=worker_id, job_type="t"
            )
            return None if result is None else result.job.id
        finally:
            own.close()

    with ThreadPoolExecutor(max_workers=len(workers)) as pool:
        results = list(pool.map(run, workers))
    claimed = [job_id for job_id in results if job_id is not None]
    assert len(claimed) == 5
    assert len(set(claimed)) == 5


def heartbeat(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, claimed: Claim
) -> Lease:
    lease, _ = store.heartbeat_job(
        conn,
        now=clock(),
        settings=settings,
        job_id=claimed.job.id,
        worker_id=claimed.lease.worker_id,
        token=claimed.lease.token,
    )
    return lease


def finish(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    claimed: Claim,
    report: SuccessReport | FailureReport,
) -> Job:
    return store.finish_job(
        conn,
        now=clock(),
        settings=settings,
        job_id=claimed.job.id,
        worker_id=claimed.lease.worker_id,
        token=claimed.lease.token,
        report=report,
    )


def release(conn: sqlite3.Connection, clock: FakeClock, settings: Settings, claimed: Claim) -> None:
    store.release_job(
        conn,
        now=clock(),
        settings=settings,
        job_id=claimed.job.id,
        worker_id=claimed.lease.worker_id,
        token=claimed.lease.token,
    )


BOOM = FailureReport(error="boom", error_detail="trace")


def test_job_heartbeat_extends_lease_but_not_deadline(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_run_ms=600_000)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(10_000)
    lease = heartbeat(conn, clock, settings, claimed)
    assert lease.until == clock.now + settings.job_lease_ms
    assert lease.deadline_at == claimed.lease.deadline_at
    assert lease.token == claimed.lease.token


def step(
    step_id: str,
    status: StepStatus = StepStatus.RUNNING,
    current: int | None = None,
    total: int | None = None,
) -> ProgressStep:
    return ProgressStep(id=step_id, status=status, current=current, total=total)


def send_steps(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    claimed: Claim,
    *steps: ProgressStep,
) -> bool:
    _, stored = store.heartbeat_job(
        conn,
        now=clock(),
        settings=settings,
        job_id=claimed.job.id,
        worker_id=claimed.lease.worker_id,
        token=claimed.lease.token,
        progress=list(steps),
    )
    return stored


def test_job_heartbeat_upserts_progress_steps_by_id_and_keeps_them_when_omitted(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    assert claimed.job.progress is None
    pending = StepStatus.PENDING
    assert send_steps(
        conn, clock, settings, claimed, step("a", pending), step("b", pending), step("c", pending)
    )
    assert send_steps(conn, clock, settings, claimed, step("b", current=3, total=10))
    assert send_steps(conn, clock, settings, claimed, step("d"), step("a", StepStatus.DONE))
    heartbeat(conn, clock, settings, claimed)
    job, _ = store.get_job(conn, job_id=claimed.job.id)
    assert job.progress == [
        step("a", StepStatus.DONE),
        step("b", current=3, total=10),
        step("c", pending),
        step("d"),
    ]


def test_job_heartbeat_drops_progress_that_would_exceed_the_step_limit(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    full = [step(f"s{i}") for i in range(MAX_PROGRESS_STEPS)]
    assert send_steps(conn, clock, settings, claimed, *full)
    assert not send_steps(conn, clock, settings, claimed, step("s0", StepStatus.DONE), step("x"))
    job, _ = store.get_job(conn, job_id=claimed.job.id)
    assert job.progress == full
    assert send_steps(conn, clock, settings, claimed, step("s0", StepStatus.DONE))


def test_claim_clears_progress_of_the_previous_attempt(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    first = claim(conn, clock, settings, wid)
    assert send_steps(conn, clock, settings, first, step("a"))
    release(conn, clock, settings, first)
    second = claim(conn, clock, settings, wid)
    assert second.job.progress is None


def test_job_heartbeat_with_wrong_token_is_rejected(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    with pytest.raises(LeaseRejectedError):
        store.heartbeat_job(
            conn,
            now=clock(),
            settings=settings,
            job_id=claimed.job.id,
            worker_id=wid,
            token=LeaseToken("wrong"),
        )


def test_job_heartbeat_from_other_worker_is_rejected(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    other = add_worker(conn, clock, settings, "w2")
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    with pytest.raises(LeaseRejectedError):
        store.heartbeat_job(
            conn,
            now=clock(),
            settings=settings,
            job_id=claimed.job.id,
            worker_id=other,
            token=claimed.lease.token,
        )


def test_finish_success_stores_result(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    done = finish(conn, clock, settings, claimed, SuccessReport(result={"ok": True}))
    assert done.status is JobStatus.SUCCESS
    assert done.result == {"ok": True}
    assert done.finished_at == clock.now
    assert done.lease is None
    _, attempts = store.get_job(conn, job_id=done.id)
    assert attempts[0].outcome is AttemptOutcome.SUCCEEDED
    assert attempts[0].ended_at == clock.now


def test_finish_failed_retries_with_backoff(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=3)
    claimed = claim(conn, clock, settings, wid)
    failed = finish(conn, clock, settings, claimed, BOOM)
    assert failed.status is JobStatus.PENDING
    assert failed.available_at == clock.now + settings.backoff_base_ms
    assert (failed.error, failed.error_detail) == ("boom", "trace")
    assert failed.lease is None
    assert failed.finished_at is None
    _, attempts = store.get_job(conn, job_id=failed.id)
    assert attempts[0].outcome is AttemptOutcome.FAILED
    assert attempts[0].error == "boom"


def test_backoff_grows_exponentially_and_caps(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    capped = replace(settings, backoff_cap_ms=3_000)
    wid = add_worker(conn, clock, capped)
    add_job(conn, clock, capped, max_attempt=10)
    delays: list[int] = []
    for _ in range(4):
        claimed = claim(conn, clock, capped, wid)
        failed = finish(conn, clock, capped, claimed, BOOM)
        delays.append(failed.available_at - clock.now)
        clock.advance(failed.available_at - clock.now)
    assert delays == [1_000, 2_000, 3_000, 3_000]


def test_reported_failure_at_max_attempt_fails_and_is_not_reclaimable(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1)
    claimed = claim(conn, clock, settings, wid)
    failed = finish(conn, clock, settings, claimed, BOOM)
    assert failed.status is JobStatus.FAILED
    assert failed.finished_at == clock.now
    with pytest.raises(LeaseRejectedError):
        heartbeat(conn, clock, settings, claimed)


def test_release_returns_job_to_pending_without_using_an_attempt(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=2)
    claimed = claim(conn, clock, settings, wid)
    release(conn, clock, settings, claimed)
    job, attempts = store.get_job(conn, job_id=claimed.job.id)
    assert job.status is JobStatus.PENDING
    assert job.available_at == clock.now
    assert job.lease is None
    assert attempts[0].outcome is AttemptOutcome.RELEASED
    again = claim(conn, clock, settings, wid)
    assert again.job.attempt == 2
    assert finish(conn, clock, settings, again, BOOM).status is JobStatus.PENDING


def test_released_job_comes_after_fresh_jobs_for_the_same_worker(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    first = add_job(conn, clock, settings)
    second = add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    assert claimed.job.id == first.id
    release(conn, clock, settings, claimed)
    assert claim(conn, clock, settings, wid).job.id == second.id


def test_release_after_lease_expiry_is_rejected(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    with pytest.raises(LeaseRejectedError):
        release(conn, clock, settings, claimed)


def test_job_heartbeat_after_deadline_is_rejected(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_run_ms=40_000)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(20_000)
    assert heartbeat(conn, clock, settings, claimed).until == claimed.lease.deadline_at
    clock.advance(20_000)
    with pytest.raises(LeaseRejectedError):
        heartbeat(conn, clock, settings, claimed)


def test_reclaim_rejected_at_deadline(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_run_ms=60_000)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    job, _ = store.get_job(conn, job_id=claimed.job.id)
    assert job.status is JobStatus.PENDING
    clock.advance(30_000)
    with pytest.raises(LeaseRejectedError):
        heartbeat(conn, clock, settings, claimed)


def test_job_heartbeat_after_lease_expiry_reclaims_with_same_token(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_run_ms=600_000)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms + 5_000)
    lease = heartbeat(conn, clock, settings, claimed)
    assert lease.token == claimed.lease.token
    assert lease.deadline_at == claimed.lease.deadline_at
    assert lease.until == clock.now + settings.job_lease_ms
    job, attempts = store.get_job(conn, job_id=claimed.job.id)
    assert job.status is JobStatus.RUNNING
    assert job.attempt == 1
    assert job.error is None
    assert len(attempts) == 1
    assert attempts[0].outcome is None
    assert attempts[0].ended_at is None


def test_finish_after_lease_expiry_reclaims_and_applies(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    done = finish(conn, clock, settings, claimed, SuccessReport(result={"v": 2}))
    assert done.status is JobStatus.SUCCESS
    assert done.result == {"v": 2}
    _, attempts = store.get_job(conn, job_id=done.id)
    assert len(attempts) == 1
    assert attempts[0].outcome is AttemptOutcome.SUCCEEDED


def run_cleanup(conn: sqlite3.Connection, clock: FakeClock, settings: Settings) -> None:
    store.cleanup(conn, now=clock(), settings=settings)


def test_cancel_pending_job(conn: sqlite3.Connection, clock: FakeClock, settings: Settings) -> None:
    job = add_job(conn, clock, settings)
    cancelled = store.cancel_job(conn, now=clock(), job_id=job.id)
    assert cancelled.status is JobStatus.CANCELLED
    assert cancelled.finished_at == clock.now


def test_cancel_running_job_closes_attempt_and_rejects_worker(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    cancelled = store.cancel_job(conn, now=clock(), job_id=claimed.job.id)
    assert cancelled.status is JobStatus.CANCELLED
    assert cancelled.lease is None
    _, attempts = store.get_job(conn, job_id=claimed.job.id)
    assert attempts[0].outcome is AttemptOutcome.CANCELLED
    with pytest.raises(LeaseRejectedError):
        heartbeat(conn, clock, settings, claimed)


def test_cancel_finished_job_raises(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    finish(conn, clock, settings, claimed, SuccessReport(result=None))
    with pytest.raises(JobAlreadyFinishedError):
        store.cancel_job(conn, now=clock(), job_id=claimed.job.id)


def test_cancel_unknown_job_raises(conn: sqlite3.Connection, clock: FakeClock) -> None:
    with pytest.raises(JobNotFoundError):
        store.cancel_job(conn, now=clock(), job_id=JobId(999))


def test_cleanup_revokes_expired_lease_to_pending_with_backoff(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    job, attempts = store.get_job(conn, job_id=claimed.job.id)
    assert job.status is JobStatus.PENDING
    assert job.lease is None
    assert job.available_at == clock.now + settings.backoff_base_ms
    assert job.error == "lease_expired"
    assert attempts[0].outcome is AttemptOutcome.LEASE_EXPIRED
    assert attempts[0].lease_token == claimed.lease.token


def test_cleanup_marks_past_deadline_as_deadline_exceeded(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_run_ms=10_000)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(10_000)
    run_cleanup(conn, clock, settings)
    job, attempts = store.get_job(conn, job_id=claimed.job.id)
    assert job.error == "deadline_exceeded"
    assert attempts[0].outcome is AttemptOutcome.DEADLINE_EXCEEDED
    with pytest.raises(LeaseRejectedError):
        heartbeat(conn, clock, settings, claimed)


def test_cleanup_leaves_live_leases_alone(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms - 1)
    run_cleanup(conn, clock, settings)
    job, _ = store.get_job(conn, job_id=claimed.job.id)
    assert job.status is JobStatus.RUNNING


def test_reclaim_after_cleanup_from_pending(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    lease = heartbeat(conn, clock, settings, claimed)
    assert lease.token == claimed.lease.token
    job, attempts = store.get_job(conn, job_id=claimed.job.id)
    assert job.status is JobStatus.RUNNING
    assert job.attempt == 1
    assert attempts[0].outcome is None


def test_reclaim_after_cleanup_from_failed(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    assert store.get_job(conn, job_id=claimed.job.id)[0].status is JobStatus.FAILED
    heartbeat(conn, clock, settings, claimed)
    job, _ = store.get_job(conn, job_id=claimed.job.id)
    assert job.status is JobStatus.RUNNING
    assert job.finished_at is None
    assert job.error is None


def test_reclaim_rejected_after_another_worker_claimed(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    clock.advance(settings.backoff_base_ms)
    other = add_worker(conn, clock, settings, "w2")
    assert claim(conn, clock, settings, other).job.id == claimed.job.id
    with pytest.raises(LeaseRejectedError):
        heartbeat(conn, clock, settings, claimed)


def test_reclaim_rejected_after_cancel(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    store.cancel_job(conn, now=clock(), job_id=claimed.job.id)
    with pytest.raises(LeaseRejectedError):
        heartbeat(conn, clock, settings, claimed)


def test_reclaim_rejected_for_a_different_worker_with_the_same_token(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    with pytest.raises(LeaseRejectedError):
        store.heartbeat_job(
            conn,
            now=clock(),
            settings=settings,
            job_id=claimed.job.id,
            worker_id=WorkerId("w2"),
            token=claimed.lease.token,
        )


def test_cleanup_purges_old_finished_jobs_with_their_attempts(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    old = add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    finish(conn, clock, settings, claimed, SuccessReport(result=None))
    still_pending = add_job(conn, clock, settings)
    clock.advance(settings.retention_ms + 1)
    run_cleanup(conn, clock, settings)
    with pytest.raises(JobNotFoundError):
        store.get_job(conn, job_id=old.id)
    assert conn.execute("SELECT COUNT(*) FROM job_attempts").fetchone()[0] == 0
    assert store.get_job(conn, job_id=still_pending.id)[0].status is JobStatus.PENDING


HOOKS: list[ReportMethod] = [
    CallbackMethod.model_validate({"type": "callback", "config": {"url": f"https://p.example/{n}"}})
    for n in ("primary", "backup")
]


def report_of(conn: sqlite3.Connection, job_id: JobId) -> Report:
    report = store.get_job(conn, job_id=job_id)[0].report
    assert report is not None
    return report


def finished_with_reports(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    report: SuccessReport | FailureReport,
    max_attempt: int | None = None,
) -> Claim:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=max_attempt, reports=HOOKS)
    claimed = claim(conn, clock, settings, wid)
    finish(conn, clock, settings, claimed, report)
    return claimed


def test_job_without_reports_has_no_report(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    job = add_job(conn, clock, settings)
    assert job.report is None
    done = finish(conn, clock, settings, claim(conn, clock, settings, wid), SuccessReport(result=1))
    assert done.report is None


def test_create_job_stores_report_methods(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = add_job(conn, clock, settings, reports=HOOKS)
    assert job.report == Report(
        methods=HOOKS, status=None, round=0, cursor=0, next_at=None, error=None
    )


def test_success_starts_report_due_now(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    report = report_of(conn, claimed.job.id)
    assert report.status is ReportStatus.PENDING
    assert report.next_at == clock.now
    assert (report.round, report.cursor, report.error) == (0, 0, None)


def test_failure_with_attempts_left_does_not_start_report(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, BOOM, max_attempt=2)
    assert report_of(conn, claimed.job.id).status is None


def test_final_failure_starts_report(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, BOOM, max_attempt=1)
    assert report_of(conn, claimed.job.id).status is ReportStatus.PENDING


def test_lease_expiry_at_max_attempt_starts_report(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1, reports=HOOKS)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    report = report_of(conn, claimed.job.id)
    assert report.status is ReportStatus.PENDING
    assert report.next_at == clock.now


def test_cancel_does_not_start_report(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = add_job(conn, clock, settings, reports=HOOKS)
    store.cancel_job(conn, now=clock(), job_id=job.id)
    assert report_of(conn, job.id).status is None


def test_reclaim_clears_started_report(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1, reports=HOOKS)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    assert report_of(conn, claimed.job.id).status is ReportStatus.PENDING
    heartbeat(conn, clock, settings, claimed)
    report = report_of(conn, claimed.job.id)
    assert (report.status, report.next_at) == (None, None)
    finish(conn, clock, settings, claimed, SuccessReport(result=None))
    assert report_of(conn, claimed.job.id).status is ReportStatus.PENDING


def take(conn: sqlite3.Connection, clock: FakeClock, settings: Settings) -> ReportTask | None:
    return store.take_due_report(conn, now=clock(), settings=settings)


def record(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    task: ReportTask,
    error: str | None,
) -> None:
    store.record_report(
        conn, now=clock(), settings=settings, job_id=task.job.id, token=task.token, error=error
    )


def taken(conn: sqlite3.Connection, clock: FakeClock, settings: Settings) -> ReportTask:
    task = take(conn, clock, settings)
    assert task is not None
    return task


def test_take_due_report_marks_reporting_with_first_method(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    task = taken(conn, clock, settings)
    assert task.job.id == claimed.job.id
    assert task.method == HOOKS[0]
    assert task.token == clock.now + settings.report_timeout_ms
    report = report_of(conn, claimed.job.id)
    assert (report.status, report.next_at) == (ReportStatus.REPORTING, task.token)
    assert take(conn, clock, settings) is None


def test_take_due_report_with_nothing_due_returns_none(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    add_job(conn, clock, settings, reports=HOOKS)
    assert take(conn, clock, settings) is None


def test_record_success_finishes_report(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    record(conn, clock, settings, taken(conn, clock, settings), None)
    report = report_of(conn, claimed.job.id)
    assert (report.status, report.next_at, report.error) == (ReportStatus.SUCCESS, None, None)


def test_failed_send_waits_backoff_then_uses_next_method(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    record(conn, clock, settings, taken(conn, clock, settings), "HTTP 500")
    report = report_of(conn, claimed.job.id)
    assert report.status is ReportStatus.PENDING
    assert (report.round, report.cursor, report.error) == (0, 1, "HTTP 500")
    assert report.next_at == clock.now + settings.report_backoff_base_ms
    clock.advance(settings.report_backoff_base_ms - 1)
    assert take(conn, clock, settings) is None
    clock.advance(1)
    assert taken(conn, clock, settings).method == HOOKS[1]


def test_report_backoff_doubles_caps_and_gives_up_after_max_rounds(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    capped = replace(settings, report_backoff_cap_ms=50_000)
    claimed = finished_with_reports(conn, clock, capped, SuccessReport(result=None))
    delays: list[int] = []
    positions: list[tuple[int, int]] = []
    for _ in range(capped.report_max_rounds * len(HOOKS) - 1):
        record(conn, clock, capped, taken(conn, clock, capped), "HTTP 500")
        report = report_of(conn, claimed.job.id)
        assert report.next_at is not None
        delays.append(report.next_at - clock.now)
        positions.append((report.round, report.cursor))
        clock.advance(report.next_at - clock.now)
    assert delays == [10_000, 20_000, 40_000, 50_000, 50_000]
    assert positions == [(0, 1), (1, 0), (1, 1), (2, 0), (2, 1)]
    record(conn, clock, capped, taken(conn, clock, capped), "HTTP 503")
    report = report_of(conn, claimed.job.id)
    assert (report.status, report.next_at) == (ReportStatus.FAILED, None)
    assert (report.round, report.cursor, report.error) == (3, 0, "HTTP 503")
    assert take(conn, clock, capped) is None


def test_overdue_reporting_counts_as_interrupted(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    taken(conn, clock, settings)
    clock.advance(settings.report_timeout_ms)
    assert take(conn, clock, settings) is None
    report = report_of(conn, claimed.job.id)
    assert report.status is ReportStatus.PENDING
    assert (report.cursor, report.error) == (1, "interrupted")
    assert report.next_at == clock.now + settings.report_backoff_base_ms


def test_record_with_stale_token_is_ignored(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    task = taken(conn, clock, settings)
    record(conn, clock, settings, replace(task, token=EpochMs(task.token + 1)), None)
    assert report_of(conn, claimed.job.id).status is ReportStatus.REPORTING


def test_record_after_reclaim_is_ignored(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1, reports=HOOKS)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    task = taken(conn, clock, settings)
    heartbeat(conn, clock, settings, claimed)
    record(conn, clock, settings, task, None)
    assert report_of(conn, claimed.job.id).status is None


def test_record_after_purge_does_not_raise(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    task = taken(conn, clock, settings)
    clock.advance(settings.retention_ms + 1)
    run_cleanup(conn, clock, settings)
    record(conn, clock, settings, task, None)
    with pytest.raises(JobNotFoundError):
        store.get_job(conn, job_id=claimed.job.id)


def test_report_writes_leave_updated_at_alone(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    updated_at = store.get_job(conn, job_id=claimed.job.id)[0].updated_at
    clock.advance(1)
    record(conn, clock, settings, taken(conn, clock, settings), "HTTP 500")
    assert store.get_job(conn, job_id=claimed.job.id)[0].updated_at == updated_at
    clock.advance(settings.report_backoff_base_ms)
    record(conn, clock, settings, taken(conn, clock, settings), None)
    assert store.get_job(conn, job_id=claimed.job.id)[0].updated_at == updated_at

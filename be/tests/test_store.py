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
    JobNotFinishedError,
    JobNotFoundError,
    JobNotPendingError,
    JobNotReplayableError,
    JobNotReportableError,
    JobNotRetryableError,
    JobQuery,
    JobSort,
    JobStatus,
    Lease,
    LeaseRejectedError,
    LeaseToken,
    ManualSend,
    ProgressStep,
    ReplayOptions,
    Report,
    ReportMethod,
    ReportStatus,
    ReportTask,
    Settings,
    StepStatus,
    SuccessReport,
    WorkerBusyError,
    WorkerConnectedError,
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
    assert len(store.list_workers(conn, now=clock(), include_offline=False)) == 1


def test_list_workers_hides_those_offline_over_a_day(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    add_worker(conn, clock, settings, "old")
    clock.advance(25 * 3_600_000)
    add_worker(conn, clock, settings, "new")
    visible = store.list_workers(conn, now=clock(), include_offline=False)
    everyone = store.list_workers(conn, now=clock(), include_offline=True)
    assert [w.id for w in visible] == ["new"]
    assert [w.id for w in everyone] == ["new", "old"]


def test_delete_worker_unknown_raises(conn: sqlite3.Connection, clock: FakeClock) -> None:
    with pytest.raises(WorkerNotFoundError):
        store.delete_worker(conn, now=clock(), worker_id=WorkerId("nope"))


def test_delete_worker_connected_raises(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    with pytest.raises(WorkerConnectedError):
        store.delete_worker(conn, now=clock(), worker_id=wid)


def test_delete_worker_busy_raises(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_run_ms=10 * settings.worker_lease_ms)
    claim(conn, clock, settings, wid)
    clock.advance(settings.worker_lease_ms + 1)
    with pytest.raises(WorkerBusyError):
        store.delete_worker(conn, now=clock(), worker_id=wid)


def test_delete_offline_idle_worker_keeps_attempt_history(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings)
    claimed = claim(conn, clock, settings, wid)
    store.release_job(
        conn,
        now=clock(),
        settings=settings,
        job_id=claimed.job.id,
        worker_id=wid,
        token=claimed.lease.token,
    )
    clock.advance(settings.worker_lease_ms + 1)
    store.delete_worker(conn, now=clock(), worker_id=wid)
    assert store.list_workers(conn, now=clock(), include_offline=True) == []
    count = conn.execute("SELECT COUNT(*) FROM job_attempts WHERE worker_id = 'w1'").fetchone()[0]
    assert count == 1


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
    jobs, total = store.list_jobs(conn, query=JobQuery(), limit=10, offset=0)
    assert [j.id for j in jobs] == [third.id, second.id, first.id]
    assert total == 3
    jobs, total = store.list_jobs(conn, query=JobQuery(job_types=("a",)), limit=10, offset=0)
    assert [j.id for j in jobs] == [third.id, first.id]
    assert total == 2
    jobs, total = store.list_jobs(conn, query=JobQuery(job_types=("a", "b")), limit=10, offset=0)
    assert [j.id for j in jobs] == [third.id, second.id, first.id]
    assert total == 3
    running = JobQuery(statuses=(JobStatus.RUNNING,))
    assert store.list_jobs(conn, query=running, limit=10, offset=0) == ([], 0)


def test_list_jobs_pages_with_offset_and_counts_all_matches(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    ids = [add_job(conn, clock, settings).id for _ in range(5)]
    jobs, total = store.list_jobs(conn, query=JobQuery(), limit=2, offset=2)
    assert [j.id for j in jobs] == [ids[2], ids[1]]
    assert total == 5
    assert store.list_jobs(conn, query=JobQuery(), limit=2, offset=10) == ([], 5)


def test_count_jobs_by_status_ignores_statuses_and_lists_every_status(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    add_job(conn, clock, settings, job_type="a")
    add_job(conn, clock, settings, job_type="b")
    counts = store.count_jobs_by_status(conn, query=JobQuery(statuses=(JobStatus.FAILED,)))
    assert counts == {
        JobStatus.PENDING: 2,
        JobStatus.RUNNING: 0,
        JobStatus.SUCCESS: 0,
        JobStatus.FAILED: 0,
        JobStatus.CANCELLED: 0,
    }
    assert (
        store.count_jobs_by_status(conn, query=JobQuery(job_types=("a",)))[JobStatus.PENDING] == 1
    )
    both = JobQuery(job_types=("a", "b"))
    assert store.count_jobs_by_status(conn, query=both)[JobStatus.PENDING] == 2


def test_last_worker_id_is_newest_attempt_worker(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = add_job(conn, clock, settings)
    assert job.last_worker_id is None
    w1 = add_worker(conn, clock, settings, "w1")
    claimed = claim(conn, clock, settings, w1)
    assert claimed.job.last_worker_id == w1
    assert store.get_job(conn, job_id=job.id)[0].last_worker_id == w1


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


def test_used_attempts_counts_only_attempts_started_since_requeue(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    job = add_job(conn, clock, settings, max_attempt=10)

    def fail_once() -> None:
        clock.advance(settings.backoff_cap_ms)
        add_worker(conn, clock, settings)
        finish(conn, clock, settings, claim(conn, clock, settings, wid), BOOM)

    fail_once()
    fail_once()
    clock.advance(1)
    requeued_at = clock()
    fail_once()
    clock.advance(settings.backoff_cap_ms)
    add_worker(conn, clock, settings)
    release(conn, clock, settings, claim(conn, clock, settings, wid))
    running = claim(conn, clock, settings, wid)
    assert store._used_attempts(conn, job.id, None) == 3  # noqa: SLF001
    assert store._used_attempts(conn, job.id, requeued_at) == 1  # noqa: SLF001
    assert running.job.attempts_used == 3


def test_attempts_used_is_zero_for_a_fresh_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = add_job(conn, clock, settings)
    assert job.attempts_used == 0
    assert job.requeued_at is None


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


def give_up_report(conn: sqlite3.Connection, clock: FakeClock, settings: Settings) -> None:
    for _ in range(len(HOOKS)):
        clock.advance(settings.report_backoff_cap_ms)
        record(conn, clock, settings, taken(conn, clock, settings), "HTTP 500")


def resend(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, job_id: JobId, index: int
) -> ReportMethod:
    del clock, settings
    return store.resend_report(conn, job_id=job_id, index=index)[1]


def record_send(
    conn: sqlite3.Connection, clock: FakeClock, job_id: JobId, index: int, error: str | None
) -> None:
    store.record_manual_send(conn, now=clock(), job_id=job_id, index=index, error=error)


@pytest.mark.parametrize("outcome", [SuccessReport(result=None), BOOM])
def test_manual_send_is_kept_per_method_beside_the_automatic_delivery(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    outcome: SuccessReport | FailureReport,
) -> None:
    one_round = replace(settings, report_max_rounds=1)
    claimed = finished_with_reports(conn, clock, one_round, outcome, max_attempt=1)
    give_up_report(conn, clock, one_round)
    before = report_of(conn, claimed.job.id)
    assert resend(conn, clock, one_round, claimed.job.id, 1) == HOOKS[1]
    record_send(conn, clock, claimed.job.id, 1, None)
    clock.advance(1_000)
    record_send(conn, clock, claimed.job.id, 0, "HTTP 503")
    after = report_of(conn, claimed.job.id)
    assert replace(after, sends={}) == before
    assert after.sends == {
        1: ManualSend(at=EpochMs(clock.now - 1_000), error=None),
        0: ManualSend(at=clock.now, error="HTTP 503"),
    }
    clock.advance(one_round.report_backoff_cap_ms)
    assert take(conn, clock, one_round) is None


def test_manual_send_overwrites_the_previous_one_for_that_method(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = succeeded_job(conn, clock, settings)
    record_send(conn, clock, job.id, 0, "HTTP 500")
    clock.advance(1_000)
    record_send(conn, clock, job.id, 0, None)
    assert report_of(conn, job.id).sends == {0: ManualSend(at=clock.now, error=None)}


def test_manual_send_leaves_job_fields_alone(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = succeeded_job(conn, clock, settings)
    record_send(conn, clock, job.id, 0, None)
    after = store.get_job(conn, job_id=job.id)[0]
    assert (after.status, after.result, after.updated_at) == (
        job.status,
        job.result,
        job.updated_at,
    )


def test_manual_sends_are_cleared_when_the_report_restarts(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1, reports=HOOKS)
    claimed = claim(conn, clock, settings, wid)
    finish(conn, clock, settings, claimed, BOOM)
    record(conn, clock, settings, taken(conn, clock, settings), None)
    record_send(conn, clock, claimed.job.id, 0, None)
    assert store.retry_job(conn, now=clock(), job_id=claimed.job.id).report == Report(
        methods=HOOKS, status=None, round=0, cursor=0, next_at=None, error=None
    )
    record_send(conn, clock, claimed.job.id, 0, None)
    assert report_of(conn, claimed.job.id).sends == {}


def test_manual_sends_are_cleared_when_a_reclaimed_job_finishes_again(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1, reports=HOOKS)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    record(conn, clock, settings, taken(conn, clock, settings), None)
    record_send(conn, clock, claimed.job.id, 0, None)
    finish(conn, clock, settings, claimed, SuccessReport(result=None))
    assert report_of(conn, claimed.job.id).sends == {}


def test_manual_sends_are_cleared_by_a_replay_that_overwrites(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = succeeded_job(conn, clock, settings)
    record_send(conn, clock, job.id, 0, None)
    store.replay_job(conn, now=clock(), job_id=job.id, options=overwrite())
    assert report_of(conn, job.id).sends == {}


def test_resend_report_rejects_job_without_reports(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    job = add_job(conn, clock, settings)
    finish(conn, clock, settings, claim(conn, clock, settings, wid), SuccessReport(result=None))
    with pytest.raises(JobNotReportableError):
        resend(conn, clock, settings, job.id, 0)


@pytest.mark.parametrize("index", [-1, len(HOOKS)])
def test_resend_report_rejects_unknown_method(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, index: int
) -> None:
    job = succeeded_job(conn, clock, settings)
    with pytest.raises(JobNotReportableError):
        resend(conn, clock, settings, job.id, index)


@pytest.mark.parametrize("busy", ["pending", "reporting"])
def test_resend_report_rejects_report_still_being_delivered(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, busy: str
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    if busy == "reporting":
        taken(conn, clock, settings)
    with pytest.raises(JobNotReportableError):
        resend(conn, clock, settings, claimed.job.id, 0)


def test_resend_report_rejects_job_that_is_replaying(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = succeeded_job(conn, clock, settings)
    store.replay_job(conn, now=clock(), job_id=job.id, options=KEEP)
    with pytest.raises(JobNotReportableError):
        resend(conn, clock, settings, job.id, 0)


def test_resend_report_unknown_job_raises(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    with pytest.raises(JobNotFoundError):
        resend(conn, clock, settings, JobId(999), 0)


def test_retry_failed_job_requeues_in_place_with_fresh_budget(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1)
    claimed = claim(conn, clock, settings, wid)
    assert finish(conn, clock, settings, claimed, BOOM).status is JobStatus.FAILED
    clock.advance(5_000)
    retried = store.retry_job(conn, now=clock(), job_id=claimed.job.id)
    assert retried.id == claimed.job.id
    assert retried.status is JobStatus.PENDING
    assert retried.available_at == clock.now
    assert retried.requeued_at == clock.now
    assert retried.attempts_used == 0
    assert retried.attempt == claimed.job.attempt
    assert retried.lease is None
    assert (retried.error, retried.error_detail, retried.result) == (None, None, None)
    assert (retried.finished_at, retried.deadline_at, retried.progress) == (None, None, None)
    again = claim(conn, clock, settings, wid)
    assert again.job.attempt == claimed.job.attempt + 1
    assert finish(conn, clock, settings, again, BOOM).status is JobStatus.FAILED


def test_retry_resets_report_like_a_fresh_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, BOOM, max_attempt=1)
    assert report_of(conn, claimed.job.id).status is ReportStatus.PENDING
    retried = store.retry_job(conn, now=clock(), job_id=claimed.job.id)
    assert retried.report == Report(
        methods=HOOKS, status=None, round=0, cursor=0, next_at=None, error=None
    )


def test_retry_cancelled_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = add_job(conn, clock, settings)
    store.cancel_job(conn, now=clock(), job_id=job.id)
    retried = store.retry_job(conn, now=clock(), job_id=job.id)
    assert retried.status is JobStatus.PENDING
    assert retried.finished_at is None


@pytest.mark.parametrize("state", ["pending", "running", "success"])
def test_retry_rejects_non_dead_jobs(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, state: str
) -> None:
    wid = add_worker(conn, clock, settings)
    job = add_job(conn, clock, settings)
    if state != "pending":
        claimed = claim(conn, clock, settings, wid)
        if state == "success":
            finish(conn, clock, settings, claimed, SuccessReport(result=None))
    with pytest.raises(JobNotRetryableError):
        store.retry_job(conn, now=clock(), job_id=job.id)


def test_retry_unknown_job_raises(conn: sqlite3.Connection, clock: FakeClock) -> None:
    with pytest.raises(JobNotFoundError):
        store.retry_job(conn, now=clock(), job_id=JobId(999))


def test_old_worker_cannot_reclaim_a_requeued_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=1)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    assert store.get_job(conn, job_id=claimed.job.id)[0].status is JobStatus.FAILED
    store.retry_job(conn, now=clock(), job_id=claimed.job.id)
    with pytest.raises(LeaseRejectedError):
        heartbeat(conn, clock, settings, claimed)
    assert store.get_job(conn, job_id=claimed.job.id)[0].status is JobStatus.PENDING


KEEP = ReplayOptions(overwrite=False, report_success=False, report_failed=False)


def overwrite(*, report_success: bool = False, report_failed: bool = False) -> ReplayOptions:
    return ReplayOptions(overwrite=True, report_success=report_success, report_failed=report_failed)


def succeeded_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, max_attempt: int = 3
) -> Job:
    """A success job (result {"v": 1}) whose report was delivered."""
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=max_attempt, reports=HOOKS)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(1_000)
    finish(conn, clock, settings, claimed, SuccessReport(result={"v": 1}))
    record(conn, clock, settings, taken(conn, clock, settings), None)
    clock.advance(1_000)
    return store.get_job(conn, job_id=claimed.job.id)[0]


def replay(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, options: ReplayOptions
) -> tuple[Job, Claim]:
    """Replay a fresh success job and claim it; returns the job before replay and the claim."""
    before = succeeded_job(conn, clock, settings)
    store.replay_job(conn, now=clock(), job_id=before.id, options=options)
    return before, claim(conn, clock, settings, WorkerId("w1"))


def test_replay_options_need_overwrite_to_report() -> None:
    with pytest.raises(ValueError, match="overwrite"):
        ReplayOptions(overwrite=False, report_success=True, report_failed=False)


def test_replay_requeues_success_job_in_place_keeping_result(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    before = succeeded_job(conn, clock, settings)
    replayed = store.replay_job(conn, now=clock(), job_id=before.id, options=KEEP)
    assert replayed.id == before.id
    assert replayed.status is JobStatus.PENDING
    assert replayed.available_at == clock.now
    assert replayed.replay == KEEP
    assert (replayed.result, replayed.finished_at) == (before.result, before.finished_at)
    assert replayed.report == before.report


def test_replay_attempt_is_marked(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    _, claimed = replay(conn, clock, settings, KEEP)
    attempts = store.get_job(conn, job_id=claimed.job.id)[1]
    assert [a.replay for a in attempts] == [False, True]


@pytest.mark.parametrize("state", ["pending", "running", "failed", "cancelled"])
def test_replay_rejects_jobs_that_did_not_succeed(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, state: str
) -> None:
    wid = add_worker(conn, clock, settings)
    job = add_job(conn, clock, settings, max_attempt=1)
    if state == "cancelled":
        store.cancel_job(conn, now=clock(), job_id=job.id)
    elif state != "pending":
        claimed = claim(conn, clock, settings, wid)
        if state == "failed":
            finish(conn, clock, settings, claimed, BOOM)
    with pytest.raises(JobNotReplayableError):
        store.replay_job(conn, now=clock(), job_id=job.id, options=KEEP)


def test_replay_rejects_job_whose_report_is_still_being_delivered(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    claimed = finished_with_reports(conn, clock, settings, SuccessReport(result=None))
    with pytest.raises(JobNotReplayableError):
        store.replay_job(conn, now=clock(), job_id=claimed.job.id, options=KEEP)


def test_replay_unknown_job_raises(conn: sqlite3.Connection, clock: FakeClock) -> None:
    with pytest.raises(JobNotFoundError):
        store.replay_job(conn, now=clock(), job_id=JobId(999), options=KEEP)


@pytest.mark.parametrize("outcome", [SuccessReport(result={"v": 2}), BOOM])
def test_replay_without_overwrite_restores_the_old_success(
    conn: sqlite3.Connection,
    clock: FakeClock,
    settings: Settings,
    outcome: SuccessReport | FailureReport,
) -> None:
    before, claimed = replay(conn, clock, settings, KEEP)
    after = finish(conn, clock, settings, claimed, outcome)
    assert after.status is JobStatus.SUCCESS
    assert (after.result, after.finished_at) == (before.result, before.finished_at)
    assert after.started_at == before.started_at
    assert (after.error, after.error_detail, after.lease) == (None, None, None)
    assert after.report == before.report


def test_replay_lease_expiry_without_overwrite_restores_the_old_success(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    before, claimed = replay(conn, clock, settings, KEEP)
    clock.advance(settings.job_lease_ms)
    run_cleanup(conn, clock, settings)
    job, attempts = store.get_job(conn, job_id=claimed.job.id)
    assert (job.status, job.result, job.error) == (JobStatus.SUCCESS, before.result, None)
    assert attempts[-1].outcome is AttemptOutcome.LEASE_EXPIRED


@pytest.mark.parametrize("options", [overwrite(report_success=True), overwrite()])
def test_replay_with_overwrite_success_stores_new_result(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, options: ReplayOptions
) -> None:
    _, claimed = replay(conn, clock, settings, options)
    after = finish(conn, clock, settings, claimed, SuccessReport(result={"v": 2}))
    assert (after.status, after.result, after.finished_at) == (
        JobStatus.SUCCESS,
        {"v": 2},
        clock.now,
    )
    assert after.report is not None
    assert (after.report.status is ReportStatus.PENDING) is options.report_success


@pytest.mark.parametrize("options", [overwrite(report_failed=True), overwrite()])
def test_replay_with_overwrite_failure_fails_without_retry(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, options: ReplayOptions
) -> None:
    _, claimed = replay(conn, clock, settings, options)
    after = finish(conn, clock, settings, claimed, BOOM)
    assert (after.status, after.result, after.error) == (JobStatus.FAILED, None, "boom")
    assert after.finished_at == clock.now
    assert after.report is not None
    assert (after.report.status is ReportStatus.PENDING) is options.report_failed


def test_replay_failure_ignores_report_success_choice(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    _, claimed = replay(conn, clock, settings, overwrite(report_success=True))
    after = finish(conn, clock, settings, claimed, BOOM)
    assert after.report is not None
    assert after.report.status is None


def test_cancel_replay_without_overwrite_restores_the_old_success(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    before, claimed = replay(conn, clock, settings, KEEP)
    after = store.cancel_job(conn, now=clock(), job_id=claimed.job.id)
    assert (after.status, after.result, after.finished_at) == (
        JobStatus.SUCCESS,
        before.result,
        before.finished_at,
    )
    attempts = store.get_job(conn, job_id=claimed.job.id)[1]
    assert attempts[-1].outcome is AttemptOutcome.CANCELLED


def test_cancel_replay_with_overwrite_cancels_and_drops_result(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    _, claimed = replay(conn, clock, settings, overwrite())
    after = store.cancel_job(conn, now=clock(), job_id=claimed.job.id)
    assert (after.status, after.result) == (JobStatus.CANCELLED, None)


def test_retry_after_failed_replay_is_a_normal_retry(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    _, claimed = replay(conn, clock, settings, overwrite())
    finish(conn, clock, settings, claimed, BOOM)
    retried = store.retry_job(conn, now=clock(), job_id=claimed.job.id)
    assert retried.replay is None
    again = claim(conn, clock, settings, claimed.lease.worker_id)
    assert finish(conn, clock, settings, again, BOOM).status is JobStatus.PENDING
    assert store.get_job(conn, job_id=claimed.job.id)[1][-1].replay is False


def test_set_priority_updates_pending_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    job = add_job(conn, clock, settings)
    clock.advance(1_000)
    updated = store.set_priority(conn, now=clock(), job_id=job.id, priority=7)
    assert updated.priority == 7
    assert updated.updated_at == clock.now


def test_set_priority_rejects_running_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    job = add_job(conn, clock, settings)
    claim(conn, clock, settings, wid)
    with pytest.raises(JobNotPendingError):
        store.set_priority(conn, now=clock(), job_id=job.id, priority=7)


def test_set_priority_unknown_job_raises(conn: sqlite3.Connection, clock: FakeClock) -> None:
    with pytest.raises(JobNotFoundError):
        store.set_priority(conn, now=clock(), job_id=JobId(999), priority=1)


def test_delete_finished_job_removes_job_and_attempts(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid = add_worker(conn, clock, settings)
    job = add_job(conn, clock, settings)
    finish(conn, clock, settings, claim(conn, clock, settings, wid), SuccessReport(result=None))
    store.delete_job(conn, job_id=job.id)
    with pytest.raises(JobNotFoundError):
        store.get_job(conn, job_id=job.id)
    rows = conn.execute("SELECT COUNT(*) FROM job_attempts WHERE job_id = ?", (job.id,))
    assert rows.fetchone()[0] == 0


@pytest.mark.parametrize("state", ["pending", "running"])
def test_delete_rejects_unfinished_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings, state: str
) -> None:
    wid = add_worker(conn, clock, settings)
    job = add_job(conn, clock, settings)
    if state == "running":
        claim(conn, clock, settings, wid)
    with pytest.raises(JobNotFinishedError):
        store.delete_job(conn, job_id=job.id)


def test_delete_unknown_job_raises(conn: sqlite3.Connection) -> None:
    with pytest.raises(JobNotFoundError):
        store.delete_job(conn, job_id=JobId(999))


def _forgotten_worker_with_reclaimable_job(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> tuple[WorkerId, Job, LeaseToken]:
    wid = add_worker(conn, clock, settings)
    add_job(conn, clock, settings, max_attempt=3, max_run_ms=10 * settings.worker_lease_ms)
    claimed = claim(conn, clock, settings, wid)
    clock.advance(settings.worker_lease_ms + 1)
    run_cleanup(conn, clock, settings)
    store.delete_worker(conn, now=clock(), worker_id=wid)
    return wid, claimed.job, claimed.lease.token


def test_forgotten_worker_cannot_reclaim_by_heartbeat(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid, job, token = _forgotten_worker_with_reclaimable_job(conn, clock, settings)
    with pytest.raises(LeaseRejectedError):
        store.heartbeat_job(
            conn, now=clock(), settings=settings, job_id=job.id, worker_id=wid, token=token
        )


def test_forgotten_worker_cannot_reclaim_by_finish(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    wid, job, token = _forgotten_worker_with_reclaimable_job(conn, clock, settings)
    with pytest.raises(LeaseRejectedError):
        store.finish_job(
            conn,
            now=clock(),
            settings=settings,
            job_id=job.id,
            worker_id=wid,
            token=token,
            report=SuccessReport(result=None),
        )


def test_running_longest_puts_running_before_requeued_with_old_start(
    conn: sqlite3.Connection, clock: FakeClock, settings: Settings
) -> None:
    w1 = add_worker(conn, clock, settings, "w1")
    w2 = add_worker(conn, clock, settings, "w2")
    old = add_job(conn, clock, settings, job_type="a")
    first = claim(conn, clock, settings, w1, "a")
    store.release_job(
        conn,
        now=clock(),
        settings=settings,
        job_id=old.id,
        worker_id=w1,
        token=first.lease.token,
    )
    clock.advance(1_000)
    running = add_job(conn, clock, settings, job_type="b")
    claim(conn, clock, settings, w2, "b")
    jobs, _ = store.list_jobs(
        conn, query=JobQuery(sort=JobSort.RUNNING_LONGEST), limit=10, offset=0
    )
    assert [j.id for j in jobs] == [running.id, old.id]

import sqlite3
import statistics

import pytest

import stats
from domain import (
    EpochMs,
    FailureReport,
    JobId,
    JobStatus,
    ProgressStep,
    Settings,
    StepStatus,
    SuccessReport,
    WorkerId,
)
from store import claim_job, create_job, finish_job, heartbeat_job, register_worker
from tests.conftest import START

MINUTE = 60_000
HOUR = 60 * MINUTE


def _worker(
    conn: sqlite3.Connection, settings: Settings, name: str, at: int, ip: str = "ip"
) -> WorkerId:
    worker_id = WorkerId(name)
    register_worker(
        conn,
        now=EpochMs(at),
        settings=settings,
        worker_id=worker_id,
        name=name,
        ip=ip,
        concurrent_limit=2,
    )
    return worker_id


def _job(conn: sqlite3.Connection, settings: Settings, at: int, job_type: str = "a") -> JobId:
    return create_job(
        conn,
        now=EpochMs(at),
        settings=settings,
        job_type=job_type,
        description={},
        max_attempt=1,
        max_run_ms=None,
        priority=0,
    ).id


def _run(
    conn: sqlite3.Connection,
    settings: Settings,
    worker_id: WorkerId,
    at: int,
    job_type: str = "a",
    *,
    ok: bool | None = None,
    took: int = MINUTE,
    progress: list[ProgressStep] | None = None,
) -> JobId:
    _worker(conn, settings, worker_id, at)
    job_id = _job(conn, settings, at, job_type)
    claim = claim_job(
        conn, now=EpochMs(at), settings=settings, worker_id=worker_id, job_type=job_type
    )
    assert claim is not None
    if progress is not None:
        heartbeat_job(
            conn,
            now=EpochMs(at),
            settings=settings,
            job_id=job_id,
            worker_id=worker_id,
            token=claim.lease.token,
            progress=progress,
        )
    if ok is not None:
        report = SuccessReport(result=None) if ok else FailureReport(error="x", error_detail=None)
        finish_job(
            conn,
            now=EpochMs(at + took),
            settings=settings,
            job_id=job_id,
            worker_id=worker_id,
            token=claim.lease.token,
            report=report,
        )
    return job_id


def test_overview_lists_running_jobs_per_worker(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    first = _worker(conn, settings, "w1", START, "10.0.0.1")
    second = _worker(conn, settings, "w2", START, "10.0.0.2")
    steps = [
        ProgressStep(id="a", status=StepStatus.RUNNING, percent=50),
        ProgressStep(id="b", status=StepStatus.DONE, current=3, total=3),
    ]
    one = _run(conn, settings, first, START, progress=steps)
    two = _run(conn, settings, second, START + 1_000)

    result = stats.overview(conn, now=EpochMs(START + 2_000))

    loads = {load.worker.id: load.running for load in result.workers}
    assert [(j.id, j.started_at, j.progress_percent) for j in loads[first]] == [(one, START, 75.0)]
    assert [(j.id, j.started_at, j.progress_percent) for j in loads[second]] == [
        (two, START + 1_000, None)
    ]
    assert result.counts[JobStatus.RUNNING] == 2


def test_overview_oldest_pending_per_type(conn: sqlite3.Connection, settings: Settings) -> None:
    ids = [_job(conn, settings, START) for _ in range(3)]
    _job(conn, settings, START, "b")
    for job_id, available_at in zip(ids, [START - 5, START - 9, START - 1], strict=True):
        conn.execute("UPDATE jobs SET available_at = ? WHERE id = ?", (available_at, job_id))

    queues = stats.overview(conn, now=START).pending_by_type

    assert [(q.type, q.pending, q.oldest_available_at) for q in queues] == [
        ("a", 3, START - 9),
        ("b", 1, START),
    ]


def test_overview_finished_totals_buckets_and_p95(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    worker = _worker(conn, settings, "w", START - 2 * HOUR)
    _run(conn, settings, worker, START - 2 * HOUR, ok=True, took=10_000)
    _run(conn, settings, worker, START - 2 * HOUR + 1_000, ok=False)
    _run(conn, settings, worker, START - 30 * HOUR, ok=True)

    result = stats.overview(conn, now=START)

    assert (result.finished_24h.success, result.finished_24h.failed) == (1, 1)
    assert (result.finished_prev_24h.success, result.finished_prev_24h.failed) == (1, 0)
    assert len(result.throughput) == 12
    assert result.throughput[-1].start == START
    by_start = {b.start: (b.success, b.failed) for b in result.throughput}
    assert by_start[EpochMs(START - 2 * HOUR)] == (1, 1)
    assert sum(s + f for s, f in by_start.values()) == 2
    assert result.run_p95_by_type == {"a": 57_500}


def test_overview_throughput_bucket_edges(conn: sqlite3.Connection, settings: Settings) -> None:
    now = START + 32 * MINUTE
    first = START - 10 * 30 * MINUTE
    for finished_at in (now - MINUTE, START, first, first - 1):
        job_id = _job(conn, settings, finished_at)
        conn.execute(
            "UPDATE jobs SET status = 'success', finished_at = ? WHERE id = ?",
            (finished_at, job_id),
        )

    buckets = stats.overview(conn, now=EpochMs(now)).throughput

    assert (buckets[0].start, buckets[-1].start) == (first, START + 30 * MINUTE)
    assert [b.success for b in buckets] == [1] + [0] * 9 + [1, 1]
    assert [b.start for b in buckets][10] == START


@pytest.mark.parametrize(("lost_ago", "alerts"), [(30 * MINUTE, 1), (2 * HOUR, 0)])
def test_overview_worker_lost_alert(
    conn: sqlite3.Connection, settings: Settings, lost_ago: int, alerts: int
) -> None:
    worker = _worker(conn, settings, "w", START - lost_ago - settings.worker_lease_ms)

    result = stats.overview(conn, now=START)

    assert [(a.kind, a.worker_id, a.job_id) for a in result.alerts] == (
        [("worker_lost", worker, None)] * alerts
    )


def test_overview_attempt_expired_alert(conn: sqlite3.Connection, settings: Settings) -> None:
    worker = _worker(conn, settings, "w", START)
    job_id = _run(conn, settings, worker, START)
    after = START + settings.job_lease_ms + 1
    conn.execute(
        "UPDATE job_attempts SET outcome = 'lease_expired', ended_at = ? WHERE job_id = ?",
        (after, job_id),
    )

    result = stats.overview(conn, now=EpochMs(after))

    assert [(a.kind, a.job_id, a.at) for a in result.alerts] == [
        ("attempt_expired", job_id, after),
        ("worker_lost", None, START + settings.worker_lease_ms),
    ]


def test_attempts_between_includes_attempt_still_running_from_before_window(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    first = _worker(conn, settings, "w1", START - HOUR)
    second = _worker(conn, settings, "w2", START - HOUR)
    running = _run(conn, settings, first, START - HOUR)
    _run(conn, settings, second, START - HOUR, ok=True, took=MINUTE)
    inside = _run(conn, settings, second, START + 5 * MINUTE, ok=True)

    rows = stats.attempts_between(
        conn, start=EpochMs(START), end=EpochMs(START + 10 * MINUTE), worker_id=None
    )
    only_first = stats.attempts_between(
        conn, start=EpochMs(START), end=EpochMs(START + 10 * MINUTE), worker_id=first
    )

    assert [r.job_id for r in rows] == [running, inside]
    assert rows[0].ended_at is None
    assert rows[0].job_type == "a"
    assert [r.job_id for r in only_first] == [running]


def _quantile(samples: list[int], pct: int) -> int:
    return round(statistics.quantiles(samples, n=100, method="inclusive")[pct - 1])


def test_stats_empty_store(conn: sqlite3.Connection) -> None:
    result = stats.stats_for_range(conn, now=START, range_="24h")

    assert result.kpis == stats.KpiValues(0, None, None, None)
    assert result.previous == stats.KpiValues(0, None, None, None)
    assert len(result.buckets) == 24
    assert all((b.success, b.failed, b.cancelled) == (0, 0, 0) for b in result.buckets)
    assert (result.by_type, result.top_errors) == ([], [])


def test_stats_run_percentiles_and_counts(conn: sqlite3.Connection, settings: Settings) -> None:
    worker = _worker(conn, settings, "w", START - HOUR)
    runs = [1_000, 2_000, 3_000, 4_000]
    for i, took in enumerate(runs):
        _run(conn, settings, worker, START - 30 * MINUTE + i * MINUTE, ok=True, took=took)
    _run(conn, settings, worker, START - 20 * MINUTE, "b", ok=False)
    _job(conn, settings, START, "b")

    result = stats.stats_for_range(conn, now=START, range_="1h")

    a, b = result.by_type
    assert (a.type, a.finished, a.success_rate) == ("a", 4, 1.0)
    assert (a.run_p50_ms, a.run_p95_ms) == (_quantile(runs, 50), _quantile(runs, 95))
    assert (b.type, b.finished, b.success_rate, b.run_p50_ms, b.pending_now) == (
        "b",
        1,
        0.0,
        None,
        1,
    )
    assert result.kpis.finished == 5
    assert result.kpis.success_rate == 0.8
    assert result.kpis.wait_p95_ms == 0
    assert [(e.error, e.type, e.count) for e in result.top_errors] == [("x", "b", 1)]
    assert sum(bucket.success + bucket.failed for bucket in result.buckets) == 5
    assert result.buckets[-1].start == START


def test_stats_previous_window_and_7d(conn: sqlite3.Connection, settings: Settings) -> None:
    worker = _worker(conn, settings, "w", START - 2 * HOUR)
    _run(conn, settings, worker, START - 90 * MINUTE, ok=True)
    _run(conn, settings, worker, START - 80 * MINUTE, ok=False)
    _run(conn, settings, worker, START - 10 * MINUTE, ok=True)

    hour = stats.stats_for_range(conn, now=START, range_="1h")
    week = stats.stats_for_range(conn, now=START, range_="7d")

    assert hour.kpis.finished == 1
    assert hour.previous is not None
    assert (hour.previous.finished, hour.previous.success_rate) == (2, 0.5)
    assert week.previous is None
    assert week.kpis.finished == 3


def test_stats_utilisation(conn: sqlite3.Connection, settings: Settings) -> None:
    worker = _worker(conn, settings, "w", START - 5 * MINUTE)
    _run(conn, settings, worker, START - 40 * MINUTE, ok=True, took=30 * MINUTE)

    result = stats.stats_for_range(conn, now=START, range_="1h")

    assert result.kpis.utilisation == 0.25


def test_stats_top_errors_fall_back_to_outcome(
    conn: sqlite3.Connection, settings: Settings
) -> None:
    worker = _worker(conn, settings, "w", START - HOUR)
    for i in range(2):
        job_id = _run(conn, settings, worker, START - 30 * MINUTE + i)
        conn.execute(
            "UPDATE job_attempts SET outcome = 'lease_expired', ended_at = ? WHERE job_id = ?",
            (START - MINUTE, job_id),
        )

    result = stats.stats_for_range(conn, now=START, range_="1h")

    assert [(e.error, e.type, e.count) for e in result.top_errors] == [("lease_expired", "a", 2)]

"""Read-only aggregate queries behind the control-room screens."""

import sqlite3
import statistics
from dataclasses import dataclass
from typing import Literal

from pydantic import TypeAdapter

import store
from domain import (
    Attempt,
    AttemptOutcome,
    EpochMs,
    JobId,
    JobStatus,
    LeaseToken,
    ProgressStep,
    Worker,
    WorkerId,
)

_STEPS = TypeAdapter(list[ProgressStep])

DAY_MS = 86_400_000
BUCKET_MS = 1_800_000
BUCKET_COUNT = 12
ALERT_WORKER_MS = 3_600_000
ALERT_ATTEMPT_MS = 900_000
P95_WINDOW_MS = 7 * DAY_MS


@dataclass(frozen=True, slots=True)
class AttemptRow(Attempt):
    """An attempt together with its job's type."""

    job_type: str


@dataclass(frozen=True, slots=True)
class RunningJob:
    """A job a worker is running now; `progress_percent` is None without step progress."""

    id: JobId
    type: str
    started_at: EpochMs
    lease_until: EpochMs
    progress_percent: float | None


@dataclass(frozen=True, slots=True)
class WorkerLoad:
    """A worker and the jobs it is running."""

    worker: Worker
    running: list[RunningJob]


@dataclass(frozen=True, slots=True)
class TypeQueue:
    """Pending jobs of one type and when the oldest became available."""

    type: str
    pending: int
    oldest_available_at: EpochMs


@dataclass(frozen=True, slots=True)
class FinishedCounts:
    """Jobs finished in a period, by outcome."""

    success: int
    failed: int


@dataclass(frozen=True, slots=True)
class Bucket:
    """Jobs finished in the 30 minutes starting at `start`."""

    start: EpochMs
    success: int
    failed: int


@dataclass(frozen=True, slots=True)
class Alert:
    """A recent worker loss or expired attempt; `job_id` is None for a lost worker."""

    kind: Literal["worker_lost", "attempt_expired"]
    worker_id: WorkerId
    job_id: JobId | None
    at: EpochMs


@dataclass(frozen=True, slots=True)
class Overview:
    """Everything the Overview screen shows."""

    counts: dict[JobStatus, int]
    workers: list[WorkerLoad]
    pending_by_type: list[TypeQueue]
    finished_24h: FinishedCounts
    finished_prev_24h: FinishedCounts
    throughput: list[Bucket]
    alerts: list[Alert]
    run_p95_by_type: dict[str, int]


def attempts_between(
    conn: sqlite3.Connection, *, start: EpochMs, end: EpochMs, worker_id: WorkerId | None
) -> list[AttemptRow]:
    """Return attempts that overlap `[start, end)`, oldest start first.

    Args:
        conn: Store connection.
        start: Window start.
        end: Window end.
        worker_id: Only this worker's attempts, or None for all.

    Returns:
        Attempts that started before `end` and had not ended by `start`.
    """
    rows = conn.execute(
        "SELECT a.*, j.type FROM job_attempts a JOIN jobs j ON j.id = a.job_id"
        " WHERE a.started_at < :end AND (a.ended_at IS NULL OR a.ended_at > :start)"
        " AND (:worker IS NULL OR a.worker_id = :worker)"
        " ORDER BY a.started_at, a.job_id, a.attempt_no",
        {"start": start, "end": end, "worker": worker_id},
    )
    return [
        AttemptRow(
            job_id=JobId(r["job_id"]),
            attempt_no=r["attempt_no"],
            worker_id=WorkerId(r["worker_id"]),
            lease_token=LeaseToken(r["lease_token"]),
            outcome=None if r["outcome"] is None else AttemptOutcome(r["outcome"]),
            error=r["error"],
            error_detail=r["error_detail"],
            started_at=EpochMs(r["started_at"]),
            ended_at=None if r["ended_at"] is None else EpochMs(r["ended_at"]),
            job_type=r["type"],
        )
        for r in rows
    ]


def _progress_percent(raw: str | None) -> float | None:
    if raw is None:
        return None
    percents: list[float] = []
    for step in _STEPS.validate_json(raw):
        if step.percent is not None:
            percents.append(step.percent)
        elif step.current is not None and step.total is not None:
            percents.append(min(step.current / step.total * 100, 100.0))
    return statistics.fmean(percents) if percents else None


def _running(conn: sqlite3.Connection) -> dict[str, list[RunningJob]]:
    rows = conn.execute(
        "SELECT j.id, j.type, j.worker_id, j.lease_until, j.progress, a.started_at"
        " FROM jobs j JOIN job_attempts a ON a.job_id = j.id AND a.attempt_no = j.attempt"
        " WHERE j.status = 'running' ORDER BY a.started_at, j.id"
    )
    by_worker: dict[str, list[RunningJob]] = {}
    for r in rows:
        job = RunningJob(
            id=JobId(r["id"]),
            type=r["type"],
            started_at=EpochMs(r["started_at"]),
            lease_until=EpochMs(r["lease_until"]),
            progress_percent=_progress_percent(r["progress"]),
        )
        by_worker.setdefault(r["worker_id"], []).append(job)
    return by_worker


def _finished(conn: sqlite3.Connection, start: int, end: int) -> FinishedCounts:
    row = conn.execute(
        "SELECT COALESCE(SUM(status = 'success'), 0) AS ok,"
        " COALESCE(SUM(status = 'failed'), 0) AS bad FROM jobs"
        " WHERE finished_at >= ? AND finished_at < ?",
        (start, end),
    ).fetchone()
    return FinishedCounts(success=row["ok"], failed=row["bad"])


def _throughput(conn: sqlite3.Connection, now: EpochMs) -> list[Bucket]:
    first = now // BUCKET_MS * BUCKET_MS - (BUCKET_COUNT - 1) * BUCKET_MS
    end = first + BUCKET_COUNT * BUCKET_MS
    rows = conn.execute(
        "SELECT (finished_at - :first) / :size AS slot,"
        " COALESCE(SUM(status = 'success'), 0) AS ok,"
        " COALESCE(SUM(status = 'failed'), 0) AS bad FROM jobs"
        " WHERE finished_at >= :first AND finished_at < :end GROUP BY slot",
        {"first": first, "end": end, "size": BUCKET_MS},
    )
    counts = {r["slot"]: (r["ok"], r["bad"]) for r in rows}
    return [
        Bucket(
            start=EpochMs(first + i * BUCKET_MS),
            success=counts.get(i, (0, 0))[0],
            failed=counts.get(i, (0, 0))[1],
        )
        for i in range(BUCKET_COUNT)
    ]


def _alerts(conn: sqlite3.Connection, now: EpochMs) -> list[Alert]:
    lost = conn.execute(
        "SELECT id, lease_until FROM workers WHERE lease_until BETWEEN ? AND ?",
        (now - ALERT_WORKER_MS, now),
    )
    expired = conn.execute(
        "SELECT worker_id, job_id, ended_at FROM job_attempts"
        " WHERE outcome IN ('lease_expired', 'deadline_exceeded') AND ended_at >= ?",
        (now - ALERT_ATTEMPT_MS,),
    )
    alerts = [
        Alert("worker_lost", WorkerId(r["id"]), None, EpochMs(r["lease_until"])) for r in lost
    ] + [
        Alert(
            "attempt_expired",
            WorkerId(r["worker_id"]),
            JobId(r["job_id"]),
            EpochMs(r["ended_at"]),
        )
        for r in expired
    ]
    return sorted(alerts, key=lambda a: a.at, reverse=True)


def _p95(samples: list[int]) -> int:
    if len(samples) == 1:
        return samples[0]
    return round(statistics.quantiles(samples, n=100, method="inclusive")[94])


def _run_p95_by_type(conn: sqlite3.Connection, now: EpochMs) -> dict[str, int]:
    rows = conn.execute(
        "SELECT j.type, a.ended_at - a.started_at AS ms FROM job_attempts a"
        " JOIN jobs j ON j.id = a.job_id"
        " WHERE a.outcome = 'succeeded' AND a.ended_at >= ?",
        (now - P95_WINDOW_MS,),
    )
    durations: dict[str, list[int]] = {}
    for r in rows:
        durations.setdefault(r["type"], []).append(r["ms"])
    return {job_type: _p95(ms) for job_type, ms in durations.items()}


def overview(conn: sqlite3.Connection, *, now: EpochMs) -> Overview:
    """Gather everything the Overview screen needs.

    Args:
        conn: Store connection.
        now: Store clock.

    Returns:
        Counts, worker load, queues, finished totals, throughput, alerts and p95 run times.
    """
    counts = dict.fromkeys(JobStatus, 0)
    for r in conn.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status"):
        counts[JobStatus(r["status"])] = r["n"]
    running = _running(conn)
    workers = [
        WorkerLoad(worker=w, running=running.get(w.id, []))
        for w in store.list_workers(conn, now=now, include_offline=False)
    ]
    queues = conn.execute(
        "SELECT type, COUNT(*) AS n, MIN(available_at) AS oldest FROM jobs"
        " WHERE status = 'pending' GROUP BY type ORDER BY n DESC, type"
    )
    return Overview(
        counts=counts,
        workers=workers,
        pending_by_type=[TypeQueue(r["type"], r["n"], EpochMs(r["oldest"])) for r in queues],
        finished_24h=_finished(conn, now - DAY_MS, now + 1),
        finished_prev_24h=_finished(conn, now - 2 * DAY_MS, now - DAY_MS),
        throughput=_throughput(conn, now),
        alerts=_alerts(conn, now),
        run_p95_by_type=_run_p95_by_type(conn, now),
    )

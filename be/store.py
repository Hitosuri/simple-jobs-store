"""Jobs store business logic. Every write runs in `db.transaction`."""

import secrets
import sqlite3
from dataclasses import replace

from pydantic import JsonValue, TypeAdapter

from db import transaction
from domain import (
    TERMINAL_STATUSES,
    Attempt,
    AttemptOutcome,
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
    Report,
    ReportMethod,
    ReportStatus,
    ReportTask,
    Settings,
    SuccessReport,
    Worker,
    WorkerId,
    WorkerLeaseExpiredError,
    WorkerNotFoundError,
)

_JSON: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
_METHODS: TypeAdapter[list[ReportMethod]] = TypeAdapter(list[ReportMethod])


def _one(cursor: sqlite3.Cursor) -> sqlite3.Row | None:
    row = cursor.fetchone()
    if row is None or isinstance(row, sqlite3.Row):
        return row
    raise TypeError


def _first(cursor: sqlite3.Cursor) -> sqlite3.Row:
    row = cursor.fetchone()
    if not isinstance(row, sqlite3.Row):
        raise TypeError
    return row


def _dump(value: JsonValue) -> str:
    return _JSON.dump_json(value).decode()


def _opt_ms(value: int | None) -> EpochMs | None:
    return None if value is None else EpochMs(value)


def _to_worker(row: sqlite3.Row) -> Worker:
    return Worker(
        id=WorkerId(row["id"]),
        name=row["name"],
        ip=row["ip"],
        concurrent_limit=row["concurrent_limit"],
        connected_at=EpochMs(row["connected_at"]),
        last_seen_at=EpochMs(row["last_seen_at"]),
        lease_until=EpochMs(row["lease_until"]),
    )


def _to_job(row: sqlite3.Row) -> Job:
    # STRICT column types and the jobs CHECKs guarantee the lease columns are all set or all NULL.
    lease = None
    if row["lease_token"] is not None:
        lease = Lease(
            worker_id=WorkerId(row["worker_id"]),
            token=LeaseToken(row["lease_token"]),
            until=EpochMs(row["lease_until"]),
            deadline_at=EpochMs(row["deadline_at"]),
        )
    report = None
    if row["report_methods"] is not None:
        report = Report(
            methods=_METHODS.validate_json(row["report_methods"]),
            status=None if row["report_status"] is None else ReportStatus(row["report_status"]),
            round=row["report_round"],
            cursor=row["report_cursor"],
            next_at=_opt_ms(row["report_next_at"]),
            error=row["report_error"],
        )
    return Job(
        id=JobId(row["id"]),
        type=row["type"],
        description=_JSON.validate_json(row["description"]),
        max_run_ms=row["max_run_ms"],
        lease=lease,
        deadline_at=_opt_ms(row["deadline_at"]),
        available_at=EpochMs(row["available_at"]),
        priority=row["priority"],
        status=JobStatus(row["status"]),
        attempt=row["attempt"],
        max_attempt=row["max_attempt"],
        error=row["error"],
        error_detail=row["error_detail"],
        result=None if row["result"] is None else _JSON.validate_json(row["result"]),
        created_at=EpochMs(row["created_at"]),
        updated_at=EpochMs(row["updated_at"]),
        started_at=_opt_ms(row["started_at"]),
        finished_at=_opt_ms(row["finished_at"]),
        report=report,
    )


def _to_attempt(row: sqlite3.Row) -> Attempt:
    return Attempt(
        job_id=JobId(row["job_id"]),
        attempt_no=row["attempt_no"],
        worker_id=WorkerId(row["worker_id"]),
        lease_token=LeaseToken(row["lease_token"]),
        outcome=None if row["outcome"] is None else AttemptOutcome(row["outcome"]),
        error=row["error"],
        error_detail=row["error_detail"],
        started_at=EpochMs(row["started_at"]),
        ended_at=_opt_ms(row["ended_at"]),
    )


def _load_job(conn: sqlite3.Connection, job_id: JobId) -> Job:
    row = _one(conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)))
    if row is None:
        raise JobNotFoundError
    return _to_job(row)


def register_worker(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    worker_id: WorkerId,
    name: str,
    ip: str,
    concurrent_limit: int,
) -> Worker:
    """Create or update a worker and give it a fresh lease.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings.
        worker_id: Id chosen by the worker.
        name: Display name.
        ip: Client address of the request.
        concurrent_limit: Declared capacity, stored for display only.

    Returns:
        The stored worker.
    """
    with transaction(conn):
        row = _first(
            conn.execute(
                """
                INSERT INTO workers
                  (id, name, ip, concurrent_limit, connected_at, last_seen_at, lease_until)
                VALUES (:id, :name, :ip, :limit, :now, :now, :lease_until)
                ON CONFLICT (id) DO UPDATE SET
                  name = excluded.name,
                  ip = excluded.ip,
                  concurrent_limit = excluded.concurrent_limit,
                  connected_at = excluded.connected_at,
                  last_seen_at = excluded.last_seen_at,
                  lease_until = excluded.lease_until
                RETURNING *
                """,
                {
                    "id": worker_id,
                    "name": name,
                    "ip": ip,
                    "limit": concurrent_limit,
                    "now": now,
                    "lease_until": now + settings.worker_lease_ms,
                },
            ),
        )
    return _to_worker(row)


def heartbeat_worker(
    conn: sqlite3.Connection, *, now: EpochMs, settings: Settings, worker_id: WorkerId
) -> Worker:
    """Extend a worker's lease.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings.
        worker_id: Worker sending the heartbeat.

    Returns:
        The updated worker.

    Raises:
        WorkerNotFoundError: The worker never registered.
    """
    with transaction(conn):
        row = _one(
            conn.execute(
                "UPDATE workers SET last_seen_at = :now, lease_until = :lease_until"
                " WHERE id = :id RETURNING *",
                {"now": now, "lease_until": now + settings.worker_lease_ms, "id": worker_id},
            ),
        )
        if row is None:
            raise WorkerNotFoundError
    return _to_worker(row)


def list_workers(conn: sqlite3.Connection) -> list[Worker]:
    """Return all workers ordered by id."""
    return [_to_worker(r) for r in conn.execute("SELECT * FROM workers ORDER BY id")]


def create_job(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    job_type: str,
    description: JsonValue,
    max_attempt: int | None,
    max_run_ms: int | None,
    priority: int,
    reports: list[ReportMethod] | None = None,
) -> Job:
    """Insert a pending job available immediately.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings (defaults for omitted limits).
        job_type: Type workers claim by.
        description: JSON payload for the worker.
        max_attempt: Attempt limit, or None for the default.
        max_run_ms: Hard run limit per claim, or None for the default.
        priority: Higher is claimed first.
        reports: Report methods in backup order, or None for no reports.

    Returns:
        The stored job.
    """
    with transaction(conn):
        row = _first(
            conn.execute(
                """
                INSERT INTO jobs (type, description, max_run_ms, available_at, priority, status,
                                  max_attempt, created_at, updated_at, report_methods)
                VALUES (:type, :description, :max_run_ms, :now, :priority, 'pending',
                        :max_attempt, :now, :now, :reports)
                RETURNING *
                """,
                {
                    "type": job_type,
                    "description": _dump(description),
                    "max_run_ms": settings.default_max_run_ms if max_run_ms is None else max_run_ms,
                    "now": now,
                    "priority": priority,
                    "max_attempt": (
                        settings.default_max_attempt if max_attempt is None else max_attempt
                    ),
                    "reports": None if reports is None else _METHODS.dump_json(reports).decode(),
                },
            ),
        )
    return _to_job(row)


def get_job(conn: sqlite3.Connection, *, job_id: JobId) -> tuple[Job, list[Attempt]]:
    """Return a job and its attempts, oldest attempt first.

    Raises:
        JobNotFoundError: No such job.
    """
    job = _load_job(conn, job_id)
    rows = conn.execute(
        "SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt_no", (job_id,)
    )
    return job, [_to_attempt(r) for r in rows]


def list_jobs(
    conn: sqlite3.Connection, *, status: JobStatus | None, job_type: str | None, limit: int
) -> list[Job]:
    """Return jobs newest first, optionally filtered by status and type."""
    rows = conn.execute(
        """
        SELECT * FROM jobs
        WHERE (:status IS NULL OR status = :status) AND (:type IS NULL OR type = :type)
        ORDER BY id DESC
        LIMIT :limit
        """,
        {"status": status, "type": job_type, "limit": limit},
    )
    return [_to_job(r) for r in rows]


_CLAIM_SQL = """
SELECT j.id FROM jobs j
WHERE j.status = 'pending' AND j.type = :type AND j.available_at <= :now
ORDER BY EXISTS (
           SELECT 1 FROM job_attempts a
           WHERE a.job_id = j.id AND a.worker_id = :worker_id
             AND a.outcome IN ('failed', 'lease_expired', 'deadline_exceeded', 'released')
         ),
         j.priority DESC, j.available_at, j.id
LIMIT 1
"""


def claim_job(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    worker_id: WorkerId,
    job_type: str,
) -> Claim | None:
    """Atomically pick the next pending job of a type and lease it to a worker.

    Jobs this worker already failed, lost or released come last; then priority (high first),
    `available_at`, id.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings.
        worker_id: Claiming worker; must hold a live worker lease.
        job_type: Type to claim.

    Returns:
        The claimed job and its new lease, or None when nothing is available.

    Raises:
        WorkerNotFoundError: The worker never registered.
        WorkerLeaseExpiredError: The worker's lease has expired.
    """
    with transaction(conn):
        worker = _one(conn.execute("SELECT lease_until FROM workers WHERE id = ?", (worker_id,)))
        if worker is None:
            raise WorkerNotFoundError
        if now >= worker["lease_until"]:
            raise WorkerLeaseExpiredError
        picked = _one(
            conn.execute(_CLAIM_SQL, {"type": job_type, "now": now, "worker_id": worker_id})
        )
        if picked is None:
            return None
        job = _load_job(conn, JobId(picked["id"]))
        deadline_at = EpochMs(now + job.max_run_ms)
        lease = Lease(
            worker_id=worker_id,
            token=LeaseToken(secrets.token_urlsafe(24)),
            until=EpochMs(min(now + settings.job_lease_ms, deadline_at)),
            deadline_at=deadline_at,
        )
        conn.execute(
            """
            UPDATE jobs SET status = 'running', worker_id = :worker_id, lease_token = :token,
                            lease_until = :until, deadline_at = :deadline_at,
                            attempt = attempt + 1, started_at = :now, updated_at = :now
            WHERE id = :id
            """,
            {
                "worker_id": worker_id,
                "token": lease.token,
                "until": lease.until,
                "deadline_at": deadline_at,
                "now": now,
                "id": job.id,
            },
        )
        conn.execute(
            "INSERT INTO job_attempts (job_id, attempt_no, worker_id, lease_token, started_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (job.id, job.attempt + 1, worker_id, lease.token, now),
        )
        return Claim(job=_load_job(conn, job.id), lease=lease)


def _count(cursor: sqlite3.Cursor) -> int:
    value = _first(cursor)[0]
    if not isinstance(value, int):
        raise TypeError
    return value


def _end_attempt(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    job: Job,
    outcome: AttemptOutcome,
    error: str | None = None,
    error_detail: str | None = None,
) -> None:
    conn.execute(
        "UPDATE job_attempts SET outcome = ?, error = ?, error_detail = ?, ended_at = ?"
        " WHERE job_id = ? AND attempt_no = ?",
        (outcome, error, error_detail, now, job.id, job.attempt),
    )


def _start_report(conn: sqlite3.Connection, *, now: EpochMs, job_id: JobId) -> None:
    conn.execute(
        """
        UPDATE jobs SET report_status = 'pending', report_next_at = :now, report_round = 0,
                        report_cursor = 0, report_error = NULL
        WHERE id = :id AND report_methods IS NOT NULL
        """,
        {"now": now, "id": job_id},
    )


def _retry_or_fail(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    job: Job,
    error: str,
    error_detail: str | None,
) -> None:
    used = _count(
        conn.execute(
            "SELECT COUNT(*) FROM job_attempts WHERE job_id = ? AND outcome IS NOT 'released'",
            (job.id,),
        ),
    )
    params = {"now": now, "error": error, "error_detail": error_detail, "id": job.id}
    if used >= job.max_attempt:
        conn.execute(
            """
            UPDATE jobs SET status = 'failed', worker_id = NULL, lease_token = NULL,
                            lease_until = NULL, error = :error, error_detail = :error_detail,
                            finished_at = :now, updated_at = :now
            WHERE id = :id
            """,
            params,
        )
        _start_report(conn, now=now, job_id=job.id)
        return
    backoff = min(settings.backoff_base_ms * 2 ** (used - 1), settings.backoff_cap_ms)
    conn.execute(
        """
        UPDATE jobs SET status = 'pending', worker_id = NULL, lease_token = NULL,
                        lease_until = NULL, error = :error, error_detail = :error_detail,
                        available_at = :available_at, updated_at = :now
        WHERE id = :id
        """,
        {**params, "available_at": now + backoff},
    )


def _expire_if_due(conn: sqlite3.Connection, *, now: EpochMs, settings: Settings, job: Job) -> Job:
    lease = job.lease
    if lease is None:
        return job
    if now >= lease.deadline_at:
        outcome = AttemptOutcome.DEADLINE_EXCEEDED
    elif now >= lease.until:
        outcome = AttemptOutcome.LEASE_EXPIRED
    else:
        return job
    _end_attempt(conn, now=now, job=job, outcome=outcome)
    _retry_or_fail(
        conn, now=now, settings=settings, job=job, error=outcome.value, error_detail=None
    )
    return _load_job(conn, job.id)


def _reclaim_lease(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    job: Job,
    worker_id: WorkerId,
    token: LeaseToken,
) -> Lease | None:
    deadline_at = job.deadline_at
    if (
        job.status not in {JobStatus.PENDING, JobStatus.FAILED}
        or deadline_at is None
        or now >= deadline_at
    ):
        return None
    row = _one(
        conn.execute(
            "SELECT * FROM job_attempts WHERE job_id = ? AND attempt_no = ?",
            (job.id, job.attempt),
        ),
    )
    if row is None:
        return None
    newest = _to_attempt(row)
    if (
        newest.outcome is not AttemptOutcome.LEASE_EXPIRED
        or newest.lease_token != token
        or newest.worker_id != worker_id
    ):
        return None
    return Lease(
        worker_id=worker_id,
        token=token,
        until=EpochMs(min(now + settings.job_lease_ms, deadline_at)),
        deadline_at=deadline_at,
    )


def _hold(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    job_id: JobId,
    worker_id: WorkerId,
    token: LeaseToken,
    allow_reclaim: bool,
) -> tuple[Job, Lease]:
    job = _expire_if_due(conn, now=now, settings=settings, job=_load_job(conn, job_id))
    lease = job.lease
    if lease is not None and lease.token == token and lease.worker_id == worker_id:
        return job, lease
    reclaimed = (
        _reclaim_lease(conn, now=now, settings=settings, job=job, worker_id=worker_id, token=token)
        if allow_reclaim
        else None
    )
    if reclaimed is None:
        raise LeaseRejectedError
    conn.execute(
        """
        UPDATE jobs SET status = 'running', worker_id = :worker_id, lease_token = :token,
                        lease_until = :until, error = NULL, error_detail = NULL,
                        finished_at = NULL, report_status = NULL, report_next_at = NULL,
                        updated_at = :now
        WHERE id = :id
        """,
        {
            "worker_id": worker_id,
            "token": token,
            "until": reclaimed.until,
            "now": now,
            "id": job_id,
        },
    )
    conn.execute(
        "UPDATE job_attempts SET outcome = NULL, error = NULL, error_detail = NULL,"
        " ended_at = NULL WHERE job_id = ? AND attempt_no = ?",
        (job_id, job.attempt),
    )
    return _load_job(conn, job_id), reclaimed


def heartbeat_job(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    job_id: JobId,
    worker_id: WorkerId,
    token: LeaseToken,
) -> Lease:
    """Extend a job lease, reclaiming the job first if the lease had expired.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings.
        job_id: Job being worked on.
        worker_id: Worker that holds the lease.
        token: Lease token from the claim.

    Returns:
        The extended lease; `until` never passes `deadline_at`.

    Raises:
        JobNotFoundError: No such job.
        LeaseRejectedError: Token neither valid nor reclaimable; the worker must abort.
    """
    with transaction(conn):
        _, lease = _hold(
            conn,
            now=now,
            settings=settings,
            job_id=job_id,
            worker_id=worker_id,
            token=token,
            allow_reclaim=True,
        )
        extended = replace(
            lease, until=EpochMs(min(now + settings.job_lease_ms, lease.deadline_at))
        )
        conn.execute(
            "UPDATE jobs SET lease_until = ?, updated_at = ? WHERE id = ?",
            (extended.until, now, job_id),
        )
    return extended


def finish_job(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    job_id: JobId,
    worker_id: WorkerId,
    token: LeaseToken,
    report: SuccessReport | FailureReport,
) -> Job:
    """Record a job's success or failure; a reclaimable job is reclaimed first.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings.
        job_id: Finished job.
        worker_id: Worker that holds the lease.
        token: Lease token from the claim.
        report: Result on success, error on failure.

    Returns:
        The job after the report: success, or pending/failed via retry rules.

    Raises:
        JobNotFoundError: No such job.
        LeaseRejectedError: Token neither valid nor reclaimable.
    """
    with transaction(conn):
        job, _ = _hold(
            conn,
            now=now,
            settings=settings,
            job_id=job_id,
            worker_id=worker_id,
            token=token,
            allow_reclaim=True,
        )
        if isinstance(report, SuccessReport):
            _end_attempt(conn, now=now, job=job, outcome=AttemptOutcome.SUCCEEDED)
            conn.execute(
                """
                UPDATE jobs SET status = 'success', result = :result, worker_id = NULL,
                                lease_token = NULL, lease_until = NULL, error = NULL,
                                error_detail = NULL, finished_at = :now, updated_at = :now
                WHERE id = :id
                """,
                {"result": _dump(report.result), "now": now, "id": job_id},
            )
            _start_report(conn, now=now, job_id=job_id)
        else:
            _end_attempt(
                conn,
                now=now,
                job=job,
                outcome=AttemptOutcome.FAILED,
                error=report.error,
                error_detail=report.error_detail,
            )
            _retry_or_fail(
                conn,
                now=now,
                settings=settings,
                job=job,
                error=report.error,
                error_detail=report.error_detail,
            )
        return _load_job(conn, job_id)


def release_job(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    job_id: JobId,
    worker_id: WorkerId,
    token: LeaseToken,
) -> None:
    """Hand a running job back to pending immediately without using an attempt.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings.
        job_id: Job to release.
        worker_id: Worker that holds the lease.
        token: Lease token from the claim.

    Raises:
        JobNotFoundError: No such job.
        LeaseRejectedError: Token not valid (reclaim is not attempted).
    """
    with transaction(conn):
        job, _ = _hold(
            conn,
            now=now,
            settings=settings,
            job_id=job_id,
            worker_id=worker_id,
            token=token,
            allow_reclaim=False,
        )
        _end_attempt(conn, now=now, job=job, outcome=AttemptOutcome.RELEASED)
        conn.execute(
            """
            UPDATE jobs SET status = 'pending', available_at = :now, worker_id = NULL,
                            lease_token = NULL, lease_until = NULL, updated_at = :now
            WHERE id = :id
            """,
            {"now": now, "id": job_id},
        )


def cancel_job(conn: sqlite3.Connection, *, now: EpochMs, job_id: JobId) -> Job:
    """Cancel a pending or running job immediately.

    A running job's attempt is closed as cancelled; its worker learns on the next job
    heartbeat (`LeaseRejectedError`).

    Args:
        conn: Store connection.
        now: Store clock.
        job_id: Job to cancel.

    Returns:
        The cancelled job.

    Raises:
        JobNotFoundError: No such job.
        JobAlreadyFinishedError: Job is already success, failed or cancelled.
    """
    with transaction(conn):
        job = _load_job(conn, job_id)
        if job.status in TERMINAL_STATUSES:
            raise JobAlreadyFinishedError
        if job.lease is not None:
            _end_attempt(conn, now=now, job=job, outcome=AttemptOutcome.CANCELLED)
        conn.execute(
            """
            UPDATE jobs SET status = 'cancelled', worker_id = NULL, lease_token = NULL,
                            lease_until = NULL, finished_at = :now, updated_at = :now
            WHERE id = :id
            """,
            {"now": now, "id": job_id},
        )
        return _load_job(conn, job_id)


def cleanup(conn: sqlite3.Connection, *, now: EpochMs, settings: Settings) -> None:
    """Revoke expired leases, then purge finished jobs older than the retention window.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings (backoff, retention).
    """
    with transaction(conn):
        expired = conn.execute(
            "SELECT id FROM jobs WHERE status = 'running'"
            " AND (lease_until <= :now OR deadline_at <= :now)",
            {"now": now},
        ).fetchall()
        for row in expired:
            _expire_if_due(conn, now=now, settings=settings, job=_load_job(conn, JobId(row["id"])))
    with transaction(conn):
        conn.execute(
            "DELETE FROM jobs WHERE status IN ('success', 'failed', 'cancelled')"
            " AND finished_at < ?",
            (now - settings.retention_ms,),
        )


def _advance_report(
    conn: sqlite3.Connection, *, now: EpochMs, settings: Settings, job: Job, error: str
) -> None:
    report = job.report
    if report is None:
        raise TypeError
    cursor = report.cursor + 1
    rounds = report.round
    if cursor == len(report.methods):
        cursor, rounds = 0, rounds + 1
    next_at: int | None
    if rounds >= settings.report_max_rounds:
        status, next_at = ReportStatus.FAILED, None
    else:
        failed_sends = rounds * len(report.methods) + cursor
        backoff = min(
            settings.report_backoff_base_ms * 2 ** (failed_sends - 1),
            settings.report_backoff_cap_ms,
        )
        if not isinstance(backoff, int):
            raise TypeError
        status, next_at = ReportStatus.PENDING, now + backoff
    conn.execute(
        "UPDATE jobs SET report_status = ?, report_next_at = ?, report_round = ?,"
        " report_cursor = ?, report_error = ? WHERE id = ?",
        (status, next_at, rounds, cursor, error, job.id),
    )


def take_due_report(
    conn: sqlite3.Connection, *, now: EpochMs, settings: Settings
) -> ReportTask | None:
    """Mark the next due report as being sent and return what to send.

    Reports still `reporting` past their send deadline (the process died mid-send) are first
    counted as a failed send with error `interrupted`.

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings (send timeout, report backoff and rounds).

    Returns:
        The job, the method at its cursor and the send token, or None when nothing is due.
    """
    with transaction(conn):
        overdue = conn.execute(
            "SELECT * FROM jobs WHERE report_status = 'reporting' AND report_next_at <= ?",
            (now,),
        ).fetchall()
        for stuck in overdue:
            _advance_report(
                conn, now=now, settings=settings, job=_to_job(stuck), error="interrupted"
            )
        row = _one(
            conn.execute(
                "SELECT * FROM jobs WHERE report_status = 'pending' AND report_next_at <= ?"
                " ORDER BY report_next_at, id LIMIT 1",
                (now,),
            ),
        )
        if row is None:
            return None
        job = _to_job(row)
        report = job.report
        if report is None:
            raise TypeError
        token = EpochMs(now + settings.report_timeout_ms)
        conn.execute(
            "UPDATE jobs SET report_status = 'reporting', report_next_at = ? WHERE id = ?",
            (token, job.id),
        )
        return ReportTask(job=job, method=report.methods[report.cursor], token=token)


def record_report(
    conn: sqlite3.Connection,
    *,
    now: EpochMs,
    settings: Settings,
    job_id: JobId,
    token: EpochMs,
    error: str | None,
) -> None:
    """Store the outcome of a send taken by `take_due_report`.

    Ignored when the report is no longer that send (job reclaimed, purged or re-finished).

    Args:
        conn: Store connection.
        now: Store clock.
        settings: Store settings (report backoff and rounds).
        job_id: Reported job.
        token: `ReportTask.token` of the send.
        error: None when delivered, else why the send failed.
    """
    with transaction(conn):
        row = _one(
            conn.execute(
                "SELECT * FROM jobs WHERE id = ? AND report_status = 'reporting'"
                " AND report_next_at = ?",
                (job_id, token),
            ),
        )
        if row is None:
            return
        if error is None:
            conn.execute(
                "UPDATE jobs SET report_status = 'success', report_next_at = NULL,"
                " report_error = NULL WHERE id = ?",
                (job_id,),
            )
            return
        _advance_report(conn, now=now, settings=settings, job=_to_job(row), error=error)

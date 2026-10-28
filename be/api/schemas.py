"""Request/response models and conversion from domain rows."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Generic, Literal, Self, TypeVar

from fastapi import Body
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    TypeAdapter,
    ValidationError,
    model_validator,
)
from pydantic.alias_generators import to_camel

from domain import (
    MAX_PROGRESS_STEPS,
    Attempt,
    AttemptOutcome,
    Claim,
    EpochMs,
    ErrorCode,
    Job,
    JobId,
    JobStatus,
    Lease,
    LeaseToken,
    ProgressStep,
    ReportMethod,
    ReportStatus,
    StepStatus,
    Worker,
    WorkerId,
)
from stats import AttemptRow, Overview, RunningJob, Stats

logger = logging.getLogger(__name__)

T = TypeVar("T")

_STEPS: TypeAdapter[list[ProgressStep]] = TypeAdapter(
    Annotated[list[ProgressStep], Field(min_length=1, max_length=MAX_PROGRESS_STEPS)]
)

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _dt(ms: int) -> datetime:
    return _EPOCH + timedelta(milliseconds=ms)


def _remaining(until: int, now: int) -> int:
    return max(until - now, 0)


class CamelModel(BaseModel):
    """Base for API models: camelCase in JSON, snake_case in Python."""

    model_config = ConfigDict(
        alias_generator=to_camel, validate_by_name=True, validate_by_alias=True
    )


class Page(CamelModel, Generic[T]):
    """One page of a list endpoint; `total` counts every item matching the filters."""

    items: list[T]
    page: int
    page_size: int
    total: int


class WorkerRegisterBody(CamelModel):
    """Body of `PUT /api/workers/{worker_id}`."""

    name: str = Field(min_length=1)
    concurrent_limit: int = Field(ge=1, le=2**63 - 1)


class WorkerOut(CamelModel):
    """A worker as shown by the API."""

    id: WorkerId
    name: str
    ip: str
    concurrent_limit: int
    connected_at: datetime
    last_seen_at: datetime
    lease_until: datetime
    lease_ms_remaining: int
    connected: bool

    @classmethod
    def build(cls, worker: Worker, now: EpochMs) -> Self:
        """Convert a stored worker, computing lease fields against `now`."""
        remaining = _remaining(worker.lease_until, now)
        return cls(
            id=worker.id,
            name=worker.name,
            ip=worker.ip,
            concurrent_limit=worker.concurrent_limit,
            connected_at=_dt(worker.connected_at),
            last_seen_at=_dt(worker.last_seen_at),
            lease_until=_dt(worker.lease_until),
            lease_ms_remaining=remaining,
            connected=remaining > 0,
        )


class WorkerLeaseOut(CamelModel):
    """Worker heartbeat response."""

    lease_until: datetime
    lease_ms_remaining: int

    @classmethod
    def build(cls, worker: Worker, now: EpochMs) -> Self:
        """Convert a worker's lease."""
        return cls(
            lease_until=_dt(worker.lease_until),
            lease_ms_remaining=_remaining(worker.lease_until, now),
        )


def _opt_dt(ms: int | None) -> datetime | None:
    return None if ms is None else _dt(ms)


class JobCreateBody(CamelModel):
    """Body of `POST /api/jobs`."""

    model_config = ConfigDict(allow_inf_nan=False)

    type: str = Field(min_length=1)
    description: JsonValue
    max_attempt: int | None = Field(default=None, ge=1, le=100)
    max_run_ms: int | None = Field(default=None, ge=1, le=86_400_000)
    priority: int = Field(default=0, ge=-(2**31), le=2**31 - 1)
    reports: list[ReportMethod] | None = Field(default=None, min_length=1, max_length=10)


class JobPatchBody(CamelModel):
    """Body of `PATCH /api/jobs/{id}`."""

    priority: int = Field(ge=-(2**31), le=2**31 - 1)


class BulkBody(CamelModel):
    """Body of `POST /api/jobs/bulk`; `priority` is required for the `priority` action only."""

    action: Literal["cancel", "retry", "delete", "priority"]
    ids: list[Annotated[int, Field(ge=1, le=2**63 - 1)]] = Field(min_length=1, max_length=1000)
    priority: int | None = Field(default=None, ge=-(2**31), le=2**31 - 1)

    @model_validator(mode="after")
    def _priority_iff_action(self) -> Self:
        if (self.action == "priority") != (self.priority is not None):
            msg = "priority is required for, and only for, the priority action"
            raise ValueError(msg)
        return self


class BulkSkip(CamelModel):
    """An id a bulk action did not apply to, with the reason."""

    id: JobId
    code: ErrorCode


class BulkOut(CamelModel):
    """`POST /api/jobs/bulk` response."""

    done: list[JobId]
    skipped: list[BulkSkip]


class ClaimBody(CamelModel):
    """Body of `POST /api/jobs/claim`."""

    worker_id: WorkerId = Field(min_length=1)
    type: str = Field(min_length=1)


class LeaseBody(CamelModel):
    """Lease proof sent with job heartbeat, finish and release."""

    worker_id: WorkerId = Field(min_length=1)
    lease_token: LeaseToken = Field(min_length=1)


class JobHeartbeatBody(LeaseBody):
    """Body of `POST /api/jobs/{id}/heartbeat`.

    `progress` is taken raw so a malformed value can be dropped without rejecting the heartbeat.
    """

    progress: JsonValue = None

    def valid_progress(self) -> list[ProgressStep] | None:
        """Return the progress steps if valid; None when missing, invalid or ids repeat."""
        if self.progress is None:
            return None
        try:
            steps = _STEPS.validate_python(self.progress)
        except ValidationError:
            steps = None
        if steps is None or len({step.id for step in steps}) != len(steps):
            logger.warning("dropped invalid progress from worker %s", self.worker_id)
            return None
        return steps


class ProgressStepOut(CamelModel):
    """One progress step; `percent` is derived from `current`/`total` when the worker sent none."""

    id: str
    status: StepStatus
    current: int | None
    total: int | None
    percent: float | None
    message: str | None

    @classmethod
    def build(cls, step: ProgressStep) -> Self:
        """Convert a stored step."""
        percent = step.percent
        if percent is None and step.current is not None and step.total is not None:
            percent = min(step.current / step.total * 100, 100.0)
        return cls(
            id=step.id,
            status=step.status,
            current=step.current,
            total=step.total,
            percent=percent,
            message=step.message,
        )


class FinishSuccessBody(LeaseBody):
    """Finish body for a successful job."""

    model_config = ConfigDict(allow_inf_nan=False)

    status: Literal["success"]
    result: JsonValue = None


class FinishFailedBody(LeaseBody):
    """Finish body for a failed job."""

    status: Literal["failed"]
    error: str = Field(min_length=1)
    error_detail: str | None = None


FinishBody = Annotated[FinishSuccessBody | FinishFailedBody, Body(discriminator="status")]


class JobOut(CamelModel):
    """A job as shown by the API. Never includes the lease token."""

    id: JobId
    type: str
    description: JsonValue
    max_run_ms: int
    worker_id: WorkerId | None
    lease_until: datetime | None
    deadline_at: datetime | None
    available_at: datetime
    priority: int
    status: JobStatus
    attempt: int
    max_attempt: int
    error: str | None
    error_detail: str | None
    result: JsonValue
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    reports: list[ReportMethod] | None
    report_status: ReportStatus | None
    report_round: int
    report_cursor: int
    report_next_at: datetime | None
    report_error: str | None
    progress: list[ProgressStepOut] | None
    requeued_at: datetime | None
    attempts_used: int
    last_worker_id: str | None

    @classmethod
    def build(cls, job: Job) -> Self:
        """Convert a stored job."""
        lease = job.lease
        report = job.report
        return cls(
            id=job.id,
            type=job.type,
            description=job.description,
            max_run_ms=job.max_run_ms,
            worker_id=None if lease is None else lease.worker_id,
            lease_until=None if lease is None else _dt(lease.until),
            deadline_at=_opt_dt(job.deadline_at),
            available_at=_dt(job.available_at),
            priority=job.priority,
            status=job.status,
            attempt=job.attempt,
            max_attempt=job.max_attempt,
            error=job.error,
            error_detail=job.error_detail,
            result=job.result,
            created_at=_dt(job.created_at),
            updated_at=_dt(job.updated_at),
            started_at=_opt_dt(job.started_at),
            finished_at=_opt_dt(job.finished_at),
            reports=None if report is None else report.methods,
            report_status=None if report is None else report.status,
            report_round=0 if report is None else report.round,
            report_cursor=0 if report is None else report.cursor,
            report_next_at=_opt_dt(None if report is None else report.next_at),
            report_error=None if report is None else report.error,
            progress=None
            if job.progress is None
            else [ProgressStepOut.build(step) for step in job.progress],
            requeued_at=_opt_dt(job.requeued_at),
            attempts_used=job.attempts_used,
            last_worker_id=job.last_worker_id,
        )


class JobCountsOut(CamelModel):
    """Number of jobs per status."""

    pending: int
    running: int
    success: int
    failed: int
    cancelled: int


class ReportBody(CamelModel):
    """JSON body a `callback` report POSTs to the provider."""

    id: JobId
    type: str
    status: JobStatus
    started_at: datetime | None
    finished_at: datetime | None
    result: JsonValue
    error: str | None
    error_detail: str | None

    @classmethod
    def build(cls, job: Job) -> Self:
        """Describe a finished job for its provider."""
        return cls(
            id=job.id,
            type=job.type,
            status=job.status,
            started_at=_opt_dt(job.started_at),
            finished_at=_opt_dt(job.finished_at),
            result=job.result,
            error=job.error,
            error_detail=job.error_detail,
        )


class AttemptOut(CamelModel):
    """One attempt as shown by the API. Never includes the lease token."""

    attempt_no: int
    worker_id: WorkerId
    outcome: AttemptOutcome | None
    error: str | None
    error_detail: str | None
    started_at: datetime
    ended_at: datetime | None

    @classmethod
    def build(cls, attempt: Attempt) -> Self:
        """Convert a stored attempt."""
        return cls(
            attempt_no=attempt.attempt_no,
            worker_id=attempt.worker_id,
            outcome=attempt.outcome,
            error=attempt.error,
            error_detail=attempt.error_detail,
            started_at=_dt(attempt.started_at),
            ended_at=_opt_dt(attempt.ended_at),
        )


class AttemptWindowOut(CamelModel):
    """One attempt of the swimlane window, with its job."""

    job_id: JobId
    job_type: str
    attempt_no: int
    worker_id: WorkerId
    outcome: AttemptOutcome | None
    started_at: datetime
    ended_at: datetime | None

    @classmethod
    def build(cls, row: AttemptRow) -> Self:
        """Convert an attempt row."""
        return cls(
            job_id=row.job_id,
            job_type=row.job_type,
            attempt_no=row.attempt_no,
            worker_id=row.worker_id,
            outcome=row.outcome,
            started_at=_dt(row.started_at),
            ended_at=_opt_dt(row.ended_at),
        )


class RunningJobOut(CamelModel):
    """A job a worker is running now."""

    id: JobId
    type: str
    started_at: datetime
    lease_until: datetime
    progress_percent: float | None

    @classmethod
    def build(cls, job: RunningJob) -> Self:
        """Convert a running job."""
        return cls(
            id=job.id,
            type=job.type,
            started_at=_dt(job.started_at),
            lease_until=_dt(job.lease_until),
            progress_percent=job.progress_percent,
        )


class WorkerLoadOut(CamelModel):
    """A worker and the jobs it is running."""

    worker: WorkerOut
    running: list[RunningJobOut]


class TypeQueueOut(CamelModel):
    """Pending jobs of one type."""

    type: str
    pending: int
    oldest_available_at: datetime


class FinishedOut(CamelModel):
    """Jobs finished in a period, by outcome."""

    success: int
    failed: int


class BucketOut(CamelModel):
    """Jobs finished in the 30 minutes starting at `start`."""

    start: datetime
    success: int
    failed: int


class AlertOut(CamelModel):
    """A recent worker loss or expired attempt."""

    kind: Literal["worker_lost", "attempt_expired"]
    worker_id: WorkerId
    job_id: JobId | None
    at: datetime


class OverviewOut(CamelModel):
    """`GET /api/overview` response."""

    counts: JobCountsOut
    workers: list[WorkerLoadOut]
    pending_by_type: list[TypeQueueOut]
    finished_24h: FinishedOut
    finished_prev_24h: FinishedOut
    throughput: list[BucketOut]
    alerts: list[AlertOut]
    run_p95_by_type: dict[str, int]

    @classmethod
    def build(cls, overview: Overview, now: EpochMs) -> Self:
        """Convert an overview, computing worker lease fields against `now`."""
        counts = overview.counts
        return cls(
            counts=JobCountsOut(
                pending=counts[JobStatus.PENDING],
                running=counts[JobStatus.RUNNING],
                success=counts[JobStatus.SUCCESS],
                failed=counts[JobStatus.FAILED],
                cancelled=counts[JobStatus.CANCELLED],
            ),
            workers=[
                WorkerLoadOut(
                    worker=WorkerOut.build(load.worker, now),
                    running=[RunningJobOut.build(job) for job in load.running],
                )
                for load in overview.workers
            ],
            pending_by_type=[
                TypeQueueOut(
                    type=q.type, pending=q.pending, oldest_available_at=_dt(q.oldest_available_at)
                )
                for q in overview.pending_by_type
            ],
            finished_24h=FinishedOut(
                success=overview.finished_24h.success, failed=overview.finished_24h.failed
            ),
            finished_prev_24h=FinishedOut(
                success=overview.finished_prev_24h.success,
                failed=overview.finished_prev_24h.failed,
            ),
            throughput=[
                BucketOut(start=_dt(b.start), success=b.success, failed=b.failed)
                for b in overview.throughput
            ],
            alerts=[
                AlertOut(kind=a.kind, worker_id=a.worker_id, job_id=a.job_id, at=_dt(a.at))
                for a in overview.alerts
            ],
            run_p95_by_type=overview.run_p95_by_type,
        )


class Kpi(CamelModel, Generic[T]):
    """A headline value and the prior window's; None when there is no data."""

    value: T | None
    previous: T | None


class KpisOut(CamelModel):
    """Headline numbers of the Stats screen."""

    finished: Kpi[int]
    success_rate: Kpi[float]
    wait_p95_ms: Kpi[int]
    utilisation: Kpi[float]


class StatsBucketOut(CamelModel):
    """Jobs finished in the bucket starting at `start`."""

    start: datetime
    success: int
    failed: int
    cancelled: int


class TypeStatsOut(CamelModel):
    """One job type's figures in the window."""

    type: str
    finished: int
    success_rate: float | None
    run_p50_ms: int | None
    run_p95_ms: int | None
    wait_p95_ms: int | None
    pending_now: int


class ErrorCountOut(CamelModel):
    """An error and how often it ended attempts of a type."""

    error: str
    type: str
    count: int


class StatsOut(CamelModel):
    """`GET /api/stats` response."""

    kpis: KpisOut
    buckets: list[StatsBucketOut]
    by_type: list[TypeStatsOut]
    top_errors: list[ErrorCountOut]

    @classmethod
    def build(cls, result: Stats) -> Self:
        """Convert stats, pairing each KPI with its previous-window value."""
        now, before = result.kpis, result.previous
        return cls(
            kpis=KpisOut(
                finished=Kpi(
                    value=now.finished, previous=None if before is None else before.finished
                ),
                success_rate=Kpi(
                    value=now.success_rate, previous=None if before is None else before.success_rate
                ),
                wait_p95_ms=Kpi(
                    value=now.wait_p95_ms, previous=None if before is None else before.wait_p95_ms
                ),
                utilisation=Kpi(
                    value=now.utilisation, previous=None if before is None else before.utilisation
                ),
            ),
            buckets=[
                StatsBucketOut(
                    start=_dt(b.start), success=b.success, failed=b.failed, cancelled=b.cancelled
                )
                for b in result.buckets
            ],
            by_type=[
                TypeStatsOut(
                    type=t.type,
                    finished=t.finished,
                    success_rate=t.success_rate,
                    run_p50_ms=t.run_p50_ms,
                    run_p95_ms=t.run_p95_ms,
                    wait_p95_ms=t.wait_p95_ms,
                    pending_now=t.pending_now,
                )
                for t in result.by_type
            ],
            top_errors=[
                ErrorCountOut(error=e.error, type=e.type, count=e.count) for e in result.top_errors
            ],
        )


class JobDetailOut(CamelModel):
    """`GET /api/jobs/{id}` response."""

    job: JobOut
    attempts: list[AttemptOut]

    @classmethod
    def build(cls, job: Job, attempts: list[Attempt]) -> Self:
        """Convert a job and its attempts."""
        return cls(job=JobOut.build(job), attempts=[AttemptOut.build(a) for a in attempts])


class JobLeaseOut(CamelModel):
    """Job heartbeat response. `progress_accepted` is None when no progress was sent."""

    lease_until: datetime
    lease_ms_remaining: int
    deadline_at: datetime
    progress_accepted: bool | None

    @classmethod
    def build(cls, lease: Lease, now: EpochMs, *, progress_accepted: bool | None) -> Self:
        """Convert a lease, computing the remaining time against `now`."""
        return cls(
            lease_until=_dt(lease.until),
            lease_ms_remaining=_remaining(lease.until, now),
            deadline_at=_dt(lease.deadline_at),
            progress_accepted=progress_accepted,
        )


class ClaimOut(CamelModel):
    """`POST /api/jobs/claim` response when a job was claimed."""

    job: JobOut
    lease_token: LeaseToken
    lease_until: datetime
    lease_ms_remaining: int
    deadline_at: datetime

    @classmethod
    def build(cls, claim: Claim, now: EpochMs) -> Self:
        """Convert a claim."""
        return cls(
            job=JobOut.build(claim.job),
            lease_token=claim.lease.token,
            lease_until=_dt(claim.lease.until),
            lease_ms_remaining=_remaining(claim.lease.until, now),
            deadline_at=_dt(claim.lease.deadline_at),
        )

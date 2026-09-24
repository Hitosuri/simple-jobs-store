"""Request/response models and conversion from domain rows."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Generic, Literal, Self, TypeVar

from fastapi import Body
from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, ValidationError
from pydantic.alias_generators import to_camel

from domain import (
    MAX_PROGRESS_STEPS,
    Attempt,
    AttemptOutcome,
    Claim,
    EpochMs,
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
        )


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

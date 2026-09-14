"""Domain types shared by the store and the API."""

import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import ClassVar, NewType

from pydantic import JsonValue

EpochMs = NewType("EpochMs", int)
WorkerId = NewType("WorkerId", str)
JobId = NewType("JobId", int)
LeaseToken = NewType("LeaseToken", str)

Clock = Callable[[], EpochMs]


def system_clock() -> EpochMs:
    """Return the store's wall clock as epoch milliseconds (UTC)."""
    return EpochMs(time.time_ns() // 1_000_000)


class JobStatus(StrEnum):
    """Lifecycle status of a job."""

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = frozenset({JobStatus.SUCCESS, JobStatus.FAILED, JobStatus.CANCELLED})


class AttemptOutcome(StrEnum):
    """How a job attempt ended."""

    SUCCEEDED = "succeeded"
    FAILED = "failed"
    LEASE_EXPIRED = "lease_expired"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    RELEASED = "released"
    CANCELLED = "cancelled"


class ErrorCode(StrEnum):
    """Error codes returned in the API error envelope."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    WORKER_NOT_FOUND = "WORKER_NOT_FOUND"
    WORKER_LEASE_EXPIRED = "WORKER_LEASE_EXPIRED"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    LEASE_REJECTED = "LEASE_REJECTED"
    JOB_ALREADY_FINISHED = "JOB_ALREADY_FINISHED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


@dataclass(frozen=True, slots=True)
class Lease:
    """The lease a worker holds on a running job."""

    worker_id: WorkerId
    token: LeaseToken
    until: EpochMs
    deadline_at: EpochMs


@dataclass(frozen=True, slots=True)
class Worker:
    """A registered worker."""

    id: WorkerId
    name: str
    ip: str
    concurrent_limit: int
    connected_at: EpochMs
    last_seen_at: EpochMs
    lease_until: EpochMs


@dataclass(frozen=True, slots=True)
class Job:
    """A job row. `lease` is set exactly when status is running."""

    id: JobId
    type: str
    description: JsonValue
    max_run_ms: int
    lease: Lease | None
    deadline_at: EpochMs | None
    available_at: EpochMs
    priority: int
    status: JobStatus
    attempt: int
    max_attempt: int
    error: str | None
    error_detail: str | None
    result: JsonValue
    created_at: EpochMs
    updated_at: EpochMs
    started_at: EpochMs | None
    finished_at: EpochMs | None


@dataclass(frozen=True, slots=True)
class Attempt:
    """One claim of a job."""

    job_id: JobId
    attempt_no: int
    worker_id: WorkerId
    lease_token: LeaseToken
    outcome: AttemptOutcome | None
    error: str | None
    error_detail: str | None
    started_at: EpochMs
    ended_at: EpochMs | None


@dataclass(frozen=True, slots=True)
class Claim:
    """A freshly claimed job and its lease."""

    job: Job
    lease: Lease


@dataclass(frozen=True, slots=True)
class SuccessReport:
    """Worker reports the job succeeded."""

    result: JsonValue


@dataclass(frozen=True, slots=True)
class FailureReport:
    """Worker reports the job failed."""

    error: str
    error_detail: str | None


class StoreError(Exception):
    """Base for errors the API maps to an error code."""

    code: ClassVar[ErrorCode]
    message: ClassVar[str]

    def __init__(self) -> None:
        """Use the class-level message."""
        super().__init__(self.message)


class WorkerNotFoundError(StoreError):
    """Worker id is not registered."""

    code = ErrorCode.WORKER_NOT_FOUND
    message = "worker is not registered"


class WorkerLeaseExpiredError(StoreError):
    """Worker lease expired; it must heartbeat or re-register before claiming."""

    code = ErrorCode.WORKER_LEASE_EXPIRED
    message = "worker lease expired"


class JobNotFoundError(StoreError):
    """Job does not exist."""

    code = ErrorCode.JOB_NOT_FOUND
    message = "job not found"


class LeaseRejectedError(StoreError):
    """Lease token is neither valid nor reclaimable; the worker must abort."""

    code = ErrorCode.LEASE_REJECTED
    message = "lease token rejected"


class JobAlreadyFinishedError(StoreError):
    """Job is already success, failed or cancelled."""

    code = ErrorCode.JOB_ALREADY_FINISHED
    message = "job already finished"


@dataclass(frozen=True, slots=True)
class Settings:
    """Store configuration. Durations are milliseconds."""

    db_path: str = "jobs.db"
    worker_lease_ms: int = 30_000
    job_lease_ms: int = 30_000
    default_max_run_ms: int = 86_400_000
    default_max_attempt: int = 3
    backoff_base_ms: int = 1_000
    backoff_cap_ms: int = 300_000
    cleanup_interval_ms: int = 5_000
    retention_ms: int = 604_800_000

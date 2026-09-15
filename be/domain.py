"""Domain types shared by the store and the API."""

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import ClassVar, Literal, NewType

from pydantic import BaseModel, HttpUrl, JsonValue

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


class ReportStatus(StrEnum):
    """Delivery state of a finished job's report."""

    PENDING = "pending"
    REPORTING = "reporting"
    SUCCESS = "success"
    FAILED = "failed"


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


class CallbackConfig(BaseModel):
    """Config of a `callback` report."""

    url: HttpUrl


class CallbackMethod(BaseModel):
    """Report by POSTing the job outcome as JSON to `config.url`; 2xx means delivered."""

    type: Literal["callback"]
    config: CallbackConfig


ReportMethod = CallbackMethod


@dataclass(frozen=True, slots=True)
class Report:
    """A job's report methods and their delivery state; `status` is None until it finishes."""

    methods: list[ReportMethod]
    status: ReportStatus | None
    round: int
    cursor: int
    next_at: EpochMs | None
    error: str | None


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
    report: Report | None


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
class ReportTask:
    """One report send taken by the reporter; `token` goes back to `record_report`."""

    job: Job
    method: ReportMethod
    token: EpochMs


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

    data_dir: str = "data"
    worker_lease_ms: int = 30_000
    job_lease_ms: int = 30_000
    default_max_run_ms: int = 86_400_000
    default_max_attempt: int = 3
    backoff_base_ms: int = 1_000
    backoff_cap_ms: int = 300_000
    cleanup_interval_ms: int = 5_000
    retention_ms: int = 604_800_000
    report_max_rounds: int = 3
    report_timeout_ms: int = 10_000
    report_backoff_base_ms: int = 10_000
    report_backoff_cap_ms: int = 600_000

    @property
    def db_path(self) -> str:
        """SQLite file: `jobs.db` inside `data_dir`, which must already exist."""
        return str(Path(self.data_dir) / "jobs.db")

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> "Settings":
        """Build settings from `JOBS_STORE_<FIELD>` variables; unset ones keep their default.

        Args:
            environ: Environment mapping, usually `os.environ`.

        Returns:
            The settings.

        Raises:
            ValueError: A numeric variable is not a positive integer.
        """
        defaults = cls()

        def positive_int(field: str, default: int) -> int:
            name = f"JOBS_STORE_{field.upper()}"
            raw = environ.get(name)
            if raw is None:
                return default
            if not raw.strip().isdecimal() or int(raw) <= 0:
                msg = f"{name} must be a positive integer, got {raw!r}"
                raise ValueError(msg)
            return int(raw)

        return cls(
            data_dir=environ.get("JOBS_STORE_DATA_DIR", defaults.data_dir),
            worker_lease_ms=positive_int("worker_lease_ms", defaults.worker_lease_ms),
            job_lease_ms=positive_int("job_lease_ms", defaults.job_lease_ms),
            default_max_run_ms=positive_int("default_max_run_ms", defaults.default_max_run_ms),
            default_max_attempt=positive_int("default_max_attempt", defaults.default_max_attempt),
            backoff_base_ms=positive_int("backoff_base_ms", defaults.backoff_base_ms),
            backoff_cap_ms=positive_int("backoff_cap_ms", defaults.backoff_cap_ms),
            cleanup_interval_ms=positive_int("cleanup_interval_ms", defaults.cleanup_interval_ms),
            retention_ms=positive_int("retention_ms", defaults.retention_ms),
            report_max_rounds=positive_int("report_max_rounds", defaults.report_max_rounds),
            report_timeout_ms=positive_int("report_timeout_ms", defaults.report_timeout_ms),
            report_backoff_base_ms=positive_int(
                "report_backoff_base_ms", defaults.report_backoff_base_ms
            ),
            report_backoff_cap_ms=positive_int(
                "report_backoff_cap_ms", defaults.report_backoff_cap_ms
            ),
        )

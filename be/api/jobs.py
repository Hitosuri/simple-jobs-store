"""Job routes."""

from typing import Annotated

from fastapi import APIRouter, Path, Query, status

import store
from api.deps import ConnDep, NowDep, SettingsDep
from api.envelope import ApiOk
from api.schemas import (
    ClaimBody,
    ClaimOut,
    FinishBody,
    FinishSuccessBody,
    JobCreateBody,
    JobDetailOut,
    JobLeaseOut,
    JobOut,
    LeaseBody,
)
from domain import FailureReport, JobId, JobStatus, SuccessReport

router = APIRouter(prefix="/jobs", tags=["jobs"])

JobIdPath = Annotated[int, Path(ge=1, le=2**63 - 1)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_job(
    body: JobCreateBody, conn: ConnDep, now: NowDep, settings: SettingsDep
) -> ApiOk[JobOut]:
    """Submit a job; it is pending and available immediately."""
    job = store.create_job(
        conn,
        now=now,
        settings=settings,
        job_type=body.type,
        description=body.description,
        max_attempt=body.max_attempt,
        max_run_ms=body.max_run_ms,
        priority=body.priority,
        reports=body.reports,
    )
    return ApiOk[JobOut](data=JobOut.build(job))


@router.get("")
def list_jobs(
    conn: ConnDep,
    job_status: Annotated[JobStatus | None, Query(alias="status")] = None,
    job_type: Annotated[str | None, Query(alias="type")] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> ApiOk[list[JobOut]]:
    """List jobs newest first."""
    jobs = store.list_jobs(conn, status=job_status, job_type=job_type, limit=limit)
    return ApiOk[list[JobOut]](data=[JobOut.build(j) for j in jobs])


@router.post("/claim")
def claim_job(
    body: ClaimBody, conn: ConnDep, now: NowDep, settings: SettingsDep
) -> ApiOk[ClaimOut | None]:
    """Claim the next job of a type; `data` is null when none is available."""
    claim = store.claim_job(
        conn, now=now, settings=settings, worker_id=body.worker_id, job_type=body.type
    )
    return ApiOk[ClaimOut | None](data=None if claim is None else ClaimOut.build(claim, now))


@router.get("/{job_id}")
def get_job(job_id: JobIdPath, conn: ConnDep) -> ApiOk[JobDetailOut]:
    """Return a job with its attempts."""
    job, attempts = store.get_job(conn, job_id=JobId(job_id))
    return ApiOk[JobDetailOut](data=JobDetailOut.build(job, attempts))


@router.post("/{job_id}/cancel")
def cancel_job(job_id: JobIdPath, conn: ConnDep, now: NowDep) -> ApiOk[JobOut]:
    """Cancel a pending or running job."""
    job = store.cancel_job(conn, now=now, job_id=JobId(job_id))
    return ApiOk[JobOut](data=JobOut.build(job))


@router.post("/{job_id}/heartbeat")
def heartbeat_job(
    job_id: JobIdPath, body: LeaseBody, conn: ConnDep, now: NowDep, settings: SettingsDep
) -> ApiOk[JobLeaseOut]:
    """Extend the job lease (reclaiming it if it had expired)."""
    lease = store.heartbeat_job(
        conn,
        now=now,
        settings=settings,
        job_id=JobId(job_id),
        worker_id=body.worker_id,
        token=body.lease_token,
    )
    return ApiOk[JobLeaseOut](data=JobLeaseOut.build(lease, now))


@router.post("/{job_id}/finish")
def finish_job(
    job_id: JobIdPath, body: FinishBody, conn: ConnDep, now: NowDep, settings: SettingsDep
) -> ApiOk[JobOut]:
    """Report success or failure of a job."""
    report = (
        SuccessReport(result=body.result)
        if isinstance(body, FinishSuccessBody)
        else FailureReport(error=body.error, error_detail=body.error_detail)
    )
    job = store.finish_job(
        conn,
        now=now,
        settings=settings,
        job_id=JobId(job_id),
        worker_id=body.worker_id,
        token=body.lease_token,
        report=report,
    )
    return ApiOk[JobOut](data=JobOut.build(job))


@router.post("/{job_id}/release")
def release_job(
    job_id: JobIdPath, body: LeaseBody, conn: ConnDep, now: NowDep, settings: SettingsDep
) -> ApiOk[None]:
    """Give the job back to pending without using an attempt."""
    store.release_job(
        conn,
        now=now,
        settings=settings,
        job_id=JobId(job_id),
        worker_id=body.worker_id,
        token=body.lease_token,
    )
    return ApiOk[None](data=None)

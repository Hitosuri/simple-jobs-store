"""Worker routes."""

from typing import Annotated

from fastapi import APIRouter, Path, Query, Request

import store
from api.deps import ConnDep, NowDep, SettingsDep
from api.envelope import ApiOk
from api.schemas import WorkerLeaseOut, WorkerOut, WorkerRegisterBody
from domain import WorkerId

router = APIRouter(prefix="/workers", tags=["workers"])

WorkerIdPath = Annotated[str, Path(min_length=1)]


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.put("/{worker_id}")
def register_worker(
    worker_id: WorkerIdPath,
    body: WorkerRegisterBody,
    request: Request,
    conn: ConnDep,
    now: NowDep,
    settings: SettingsDep,
) -> ApiOk[WorkerOut]:
    """Register a worker, or refresh its info and lease."""
    worker = store.register_worker(
        conn,
        now=now,
        settings=settings,
        worker_id=WorkerId(worker_id),
        name=body.name,
        ip=_client_ip(request),
        concurrent_limit=body.concurrent_limit,
    )
    return ApiOk[WorkerOut](data=WorkerOut.build(worker, now))


@router.post("/{worker_id}/heartbeat")
def heartbeat_worker(
    worker_id: WorkerIdPath, request: Request, conn: ConnDep, now: NowDep, settings: SettingsDep
) -> ApiOk[WorkerLeaseOut]:
    """Extend the worker's lease and refresh its ip. Carries no job information."""
    worker = store.heartbeat_worker(
        conn, now=now, settings=settings, worker_id=WorkerId(worker_id), ip=_client_ip(request)
    )
    return ApiOk[WorkerLeaseOut](data=WorkerLeaseOut.build(worker, now))


@router.get("")
def list_workers(
    conn: ConnDep,
    now: NowDep,
    *,
    include_offline: Annotated[bool, Query(alias="includeOffline")] = False,
) -> ApiOk[list[WorkerOut]]:
    """List workers with their connection state; hides those offline over 24 hours by default."""
    workers = store.list_workers(conn, now=now, include_offline=include_offline)
    return ApiOk[list[WorkerOut]](data=[WorkerOut.build(w, now) for w in workers])


@router.delete("/{worker_id}")
def delete_worker(worker_id: WorkerIdPath, conn: ConnDep, now: NowDep) -> ApiOk[None]:
    """Forget an offline worker that holds no job."""
    store.delete_worker(conn, now=now, worker_id=WorkerId(worker_id))
    return ApiOk[None](data=None)

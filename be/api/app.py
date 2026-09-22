"""Application factory and the background cleaner and reporter."""

import asyncio
import contextlib
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, closing
from http import HTTPStatus

import httpx2
from fastapi import FastAPI
from typing_extensions import override

import reports
import store
from api import jobs, workers
from api.deps import Runtime
from api.envelope import install_error_handlers
from api.schemas import ReportBody
from db import connect, init_schema
from domain import Clock, Settings

logger = logging.getLogger(__name__)

_POLLING = re.compile(
    r"POST /api/jobs/claim|POST /api/(jobs|workers)/[^/]+/heartbeat|GET /api/workers"
)


class PollingAccessFilter(logging.Filter):
    """Drop successful claim, heartbeat and worker-list polling from uvicorn's access log."""

    @override
    def filter(self, record: logging.LogRecord) -> bool:
        """Keep the record unless it is a polling request answered below 400."""
        match record.args:
            case (_, str() as method, str() as path, _, int() as status):
                if status >= HTTPStatus.BAD_REQUEST:
                    return True
                return not _POLLING.fullmatch(f"{method} {path.partition('?')[0]}")
            case _:
                return True


def _cleanup_once(settings: Settings, clock: Clock) -> None:
    with closing(connect(settings.db_path)) as conn:
        store.cleanup(conn, now=clock(), settings=settings)


async def _run_cleaner(settings: Settings, clock: Clock) -> None:
    while True:
        await asyncio.sleep(settings.cleanup_interval_ms / 1000)
        try:
            await asyncio.to_thread(_cleanup_once, settings, clock)
        except Exception:
            logger.exception("cleanup failed")


def _report_once(settings: Settings, clock: Clock, client: httpx2.Client) -> None:
    with closing(connect(settings.db_path)) as conn:
        while (task := store.take_due_report(conn, now=clock(), settings=settings)) is not None:
            body = ReportBody.build(task.job).model_dump(mode="json", by_alias=True)
            error = reports.send(client, task.method, body)
            store.record_report(
                conn,
                now=clock(),
                settings=settings,
                job_id=task.job.id,
                token=task.token,
                error=error,
            )


async def _run_reporter(settings: Settings, clock: Clock, client: httpx2.Client) -> None:
    while True:
        await asyncio.sleep(settings.cleanup_interval_ms / 1000)
        try:
            await asyncio.to_thread(_report_once, settings, clock, client)
        except Exception:
            logger.exception("reporting failed")


def create_app(settings: Settings, clock: Clock) -> FastAPI:
    """Build the FastAPI app; the lifespan creates the schema and runs the cleaner and reporter.

    Args:
        settings: Store settings.
        clock: Store clock (injected so tests control time).

    Returns:
        The configured application.
    """

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        with closing(connect(settings.db_path)) as conn:
            init_schema(conn)
        with httpx2.Client(timeout=settings.report_timeout_ms / 1000) as http:
            tasks = [
                asyncio.create_task(_run_cleaner(settings, clock)),
                asyncio.create_task(_run_reporter(settings, clock, http)),
            ]
            yield
            for task in tasks:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(title="simple-jobs-store", lifespan=lifespan)
    app.state.runtime = Runtime(settings=settings, clock=clock)
    install_error_handlers(app)
    app.include_router(workers.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    return app

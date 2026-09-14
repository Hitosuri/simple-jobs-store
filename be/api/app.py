"""Application factory and the background cleaner."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, closing

from fastapi import FastAPI

import store
from api import jobs, workers
from api.deps import Runtime
from api.envelope import install_error_handlers
from db import connect, init_schema
from domain import Clock, Settings

logger = logging.getLogger(__name__)


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


def create_app(settings: Settings, clock: Clock) -> FastAPI:
    """Build the FastAPI app; the lifespan creates the schema and runs the cleaner.

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
        cleaner = asyncio.create_task(_run_cleaner(settings, clock))
        yield
        cleaner.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await cleaner

    app = FastAPI(title="simple-jobs-store", lifespan=lifespan)
    app.state.runtime = Runtime(settings=settings, clock=clock)
    install_error_handlers(app)
    app.include_router(workers.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    return app

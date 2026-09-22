"""Serve the jobs store from the repo root: `uv run --project be --env-file .env be/main.py`."""

import logging
import os

import uvicorn

from api.app import PollingAccessFilter, create_app
from domain import Settings, system_clock

app = create_app(Settings.from_env(os.environ), system_clock)

if __name__ == "__main__":
    # uvicorn configures only its own loggers; without a root handler app INFO logs are dropped.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s - %(message)s")
    logging.getLogger("uvicorn.access").addFilter(PollingAccessFilter())
    uvicorn.run(
        app,
        host=os.environ.get("JOBS_STORE_HOST", "127.0.0.1"),
        port=int(os.environ.get("JOBS_STORE_PORT", "8000")),
    )

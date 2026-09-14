"""Serve the jobs store from the repo root: `uv run --project be --env-file .env be/main.py`."""

import os

import uvicorn

from api.app import create_app
from domain import Settings, system_clock

app = create_app(Settings.from_env(os.environ), system_clock)

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("JOBS_STORE_HOST", "127.0.0.1"),
        port=int(os.environ.get("JOBS_STORE_PORT", "8000")),
    )

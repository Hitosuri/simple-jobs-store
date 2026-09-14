"""Serve the jobs store: `uv run --directory be main.py`."""

import os

import uvicorn

from api.app import create_app
from domain import Settings, system_clock

app = create_app(Settings(db_path=os.environ.get("JOBS_STORE_DB", "jobs.db")), system_clock)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)

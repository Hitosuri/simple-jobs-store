"""FastAPI dependencies: settings, store clock, per-request connection."""

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from db import connect
from domain import Clock, EpochMs, Settings


@dataclass(frozen=True, slots=True)
class Runtime:
    """What `create_app` stores on `app.state` for request dependencies."""

    settings: Settings
    clock: Clock


def get_runtime(request: Request) -> Runtime:
    """Return the app's runtime, narrowed from the untyped `app.state`."""
    runtime = request.app.state.runtime
    if not isinstance(runtime, Runtime):
        raise TypeError
    return runtime


RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


def get_settings(runtime: RuntimeDep) -> Settings:
    """Return the settings the app was created with."""
    return runtime.settings


def get_now(runtime: RuntimeDep) -> EpochMs:
    """Read the store clock once per request."""
    return runtime.clock()


def get_conn(runtime: RuntimeDep) -> Iterator[sqlite3.Connection]:
    """Open a connection for the request and close it afterwards."""
    conn = connect(runtime.settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


SettingsDep = Annotated[Settings, Depends(get_settings)]
NowDep = Annotated[EpochMs, Depends(get_now)]
ConnDep = Annotated[sqlite3.Connection, Depends(get_conn)]

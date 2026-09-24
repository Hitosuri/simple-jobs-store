"""FastAPI dependencies: settings, store clock, per-request connection."""

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query, Request

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


@dataclass(frozen=True, slots=True)
class PageParams:
    """1-based page number and page size requested by a list endpoint."""

    page: int
    page_size: int

    @property
    def offset(self) -> int:
        """Rows to skip before this page."""
        return (self.page - 1) * self.page_size


def get_page_params(
    page: Annotated[int, Query(ge=1, le=2**31 - 1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=1000)] = 100,
) -> PageParams:
    """Read `?page=&pageSize=` shared by every paginated list."""
    return PageParams(page=page, page_size=page_size)


SettingsDep = Annotated[Settings, Depends(get_settings)]
PageDep = Annotated[PageParams, Depends(get_page_params)]
NowDep = Annotated[EpochMs, Depends(get_now)]
ConnDep = Annotated[sqlite3.Connection, Depends(get_conn)]

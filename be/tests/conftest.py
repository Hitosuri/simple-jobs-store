"""Shared fixtures."""

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from db import connect, init_schema
from domain import EpochMs, Settings

START = EpochMs(1_800_000_000_000)


@dataclass
class FakeClock:
    """Manually advanced clock."""

    now: EpochMs = START

    def __call__(self) -> EpochMs:
        """Return the current fake time."""
        return self.now

    def advance(self, ms: int) -> None:
        """Move time forward."""
        self.now = EpochMs(self.now + ms)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=str(tmp_path), cleanup_interval_ms=3_600_000)


@pytest.fixture
def conn(settings: Settings) -> Iterator[sqlite3.Connection]:
    connection = connect(settings.db_path)
    init_schema(connection)
    yield connection
    connection.close()


@pytest.fixture
def client(settings: Settings, clock: FakeClock) -> Iterator[TestClient]:
    with TestClient(create_app(settings, clock)) as test_client:
        yield test_client

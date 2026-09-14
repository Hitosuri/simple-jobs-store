from pathlib import Path

import pytest

from domain import Settings


def test_from_env_without_variables_uses_defaults() -> None:
    assert Settings.from_env({}) == Settings()


def test_from_env_overrides_set_variables() -> None:
    settings = Settings.from_env({"JOBS_STORE_DATA_DIR": "x", "JOBS_STORE_JOB_LEASE_MS": "5000"})
    assert settings == Settings(data_dir="x", job_lease_ms=5_000)


def test_db_path_is_jobs_db_inside_data_dir() -> None:
    assert Path(Settings(data_dir="x").db_path) == Path("x/jobs.db")


@pytest.mark.parametrize("raw", ["0", "-1", "abc", "1.5", ""])
def test_from_env_rejects_non_positive_integers(raw: str) -> None:
    with pytest.raises(ValueError, match="JOBS_STORE_RETENTION_MS"):
        Settings.from_env({"JOBS_STORE_RETENTION_MS": raw})

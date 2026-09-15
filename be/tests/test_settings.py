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


def test_from_env_reads_report_settings() -> None:
    settings = Settings.from_env(
        {
            "JOBS_STORE_REPORT_MAX_ROUNDS": "5",
            "JOBS_STORE_REPORT_TIMEOUT_MS": "2000",
            "JOBS_STORE_REPORT_BACKOFF_BASE_MS": "100",
            "JOBS_STORE_REPORT_BACKOFF_CAP_MS": "900",
        }
    )
    assert settings == Settings(
        report_max_rounds=5,
        report_timeout_ms=2_000,
        report_backoff_base_ms=100,
        report_backoff_cap_ms=900,
    )


def test_report_settings_defaults() -> None:
    settings = Settings()
    assert (
        settings.report_max_rounds,
        settings.report_timeout_ms,
        settings.report_backoff_base_ms,
        settings.report_backoff_cap_ms,
    ) == (3, 10_000, 10_000, 600_000)

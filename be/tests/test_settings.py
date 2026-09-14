import pytest

from domain import Settings


def test_from_env_without_variables_uses_defaults() -> None:
    assert Settings.from_env({}) == Settings()


def test_from_env_overrides_set_variables() -> None:
    settings = Settings.from_env({"JOBS_STORE_DB_PATH": "x.db", "JOBS_STORE_JOB_LEASE_MS": "5000"})
    assert settings == Settings(db_path="x.db", job_lease_ms=5_000)


@pytest.mark.parametrize("raw", ["0", "-1", "abc", "1.5", ""])
def test_from_env_rejects_non_positive_integers(raw: str) -> None:
    with pytest.raises(ValueError, match="JOBS_STORE_RETENTION_MS"):
        Settings.from_env({"JOBS_STORE_RETENTION_MS": raw})

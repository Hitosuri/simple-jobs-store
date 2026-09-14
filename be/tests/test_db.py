import sqlite3

import pytest

from db import transaction

INSERT_JOB = """
INSERT INTO jobs (type, description, max_run_ms, available_at, status, max_attempt,
                  created_at, updated_at, worker_id, lease_token, lease_until, deadline_at)
VALUES ('t', '{}', 1000, 0, ?, 3, 0, 0, ?, ?, ?, ?)
"""


def test_pending_job_without_lease_is_accepted(conn: sqlite3.Connection) -> None:
    with transaction(conn):
        conn.execute(INSERT_JOB, ("pending", None, None, None, None))
    assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1


def test_running_job_with_full_lease_is_accepted(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT INTO workers VALUES ('w1', 'n', '127.0.0.1', 1, 0, 0, 0)",
    )
    with transaction(conn):
        conn.execute(INSERT_JOB, ("running", "w1", "tok", 10, 20))


@pytest.mark.parametrize(
    ("status", "worker_id", "token", "lease_until", "deadline_at"),
    [
        ("running", None, None, None, None),
        ("pending", "w1", "tok", 10, 20),
        ("running", "w1", "tok", None, 20),
        ("running", "w1", "tok", 10, None),
    ],
)
def test_lease_invariant_is_enforced(
    conn: sqlite3.Connection,
    status: str,
    worker_id: str | None,
    token: str | None,
    lease_until: int | None,
    deadline_at: int | None,
) -> None:
    conn.execute("INSERT INTO workers VALUES ('w1', 'n', '127.0.0.1', 1, 0, 0, 0)")
    with pytest.raises(sqlite3.IntegrityError), transaction(conn):
        conn.execute(INSERT_JOB, (status, worker_id, token, lease_until, deadline_at))


def test_transaction_rolls_back_on_error(conn: sqlite3.Connection) -> None:
    with pytest.raises(RuntimeError), transaction(conn):  # noqa: PT012
        conn.execute(INSERT_JOB, ("pending", None, None, None, None))
        raise RuntimeError
    assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0


def test_deleting_job_cascades_to_attempts(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO workers VALUES ('w1', 'n', '127.0.0.1', 1, 0, 0, 0)")
    with transaction(conn):
        conn.execute(INSERT_JOB, ("pending", None, None, None, None))
        conn.execute(
            "INSERT INTO job_attempts (job_id, attempt_no, worker_id, lease_token, started_at)"
            " VALUES (1, 1, 'w1', 'tok', 0)",
        )
        conn.execute("DELETE FROM jobs WHERE id = 1")
    assert conn.execute("SELECT COUNT(*) FROM job_attempts").fetchone()[0] == 0

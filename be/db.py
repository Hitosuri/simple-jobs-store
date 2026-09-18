"""SQLite connection, schema and transactions."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS workers (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  ip               TEXT NOT NULL,
  concurrent_limit INTEGER NOT NULL CHECK (concurrent_limit >= 1),
  connected_at     INTEGER NOT NULL,
  last_seen_at     INTEGER NOT NULL,
  lease_until      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,
  description  TEXT NOT NULL,
  max_run_ms   INTEGER NOT NULL CHECK (max_run_ms > 0),
  worker_id    TEXT REFERENCES workers(id),
  lease_token  TEXT,
  lease_until  INTEGER,
  deadline_at  INTEGER,
  available_at INTEGER NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL
               CHECK (status IN ('pending','running','success','failed','cancelled')),
  attempt      INTEGER NOT NULL DEFAULT 0,
  max_attempt  INTEGER NOT NULL CHECK (max_attempt >= 1),
  error        TEXT,
  error_detail TEXT,
  result       TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER,
  report_methods TEXT,
  report_status  TEXT
                 CHECK (report_status IN ('pending','reporting','success','failed')),
  report_round   INTEGER NOT NULL DEFAULT 0,
  report_cursor  INTEGER NOT NULL DEFAULT 0,
  report_next_at INTEGER,
  report_error   TEXT,
  progress       TEXT,
  CHECK ((status = 'running') = (lease_token IS NOT NULL)),
  CHECK ((lease_token IS NULL) = (worker_id IS NULL)),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (lease_token IS NULL OR deadline_at IS NOT NULL),
  CHECK (report_status IS NULL OR report_methods IS NOT NULL),
  CHECK (COALESCE(report_status IN ('pending','reporting'), 0) = (report_next_at IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS job_attempts (
  job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_no   INTEGER NOT NULL,
  worker_id    TEXT NOT NULL,
  lease_token  TEXT NOT NULL,
  outcome      TEXT CHECK (outcome IN ('succeeded','failed','lease_expired',
                                       'deadline_exceeded','released','cancelled')),
  error        TEXT,
  error_detail TEXT,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  PRIMARY KEY (job_id, attempt_no)
) STRICT;

CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status, type, available_at);
CREATE INDEX IF NOT EXISTS jobs_lease ON jobs(status, lease_until);
CREATE INDEX IF NOT EXISTS jobs_deadline ON jobs(status, deadline_at);
CREATE INDEX IF NOT EXISTS jobs_finished ON jobs(status, finished_at);
CREATE INDEX IF NOT EXISTS jobs_report_due ON jobs(report_status, report_next_at);
CREATE INDEX IF NOT EXISTS attempts_worker ON job_attempts(worker_id, job_id);
"""


def connect(db_path: str) -> sqlite3.Connection:
    """Open a connection in manual-transaction mode with foreign keys and WAL on.

    Args:
        db_path: Path to the SQLite file.

    Returns:
        A connection whose rows are `sqlite3.Row`.
    """
    # FastAPI may run a sync dependency and its endpoint on different threadpool threads.
    conn = sqlite3.connect(db_path, timeout=5, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Create tables and indexes if missing."""
    conn.executescript(SCHEMA)


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[None]:
    """Run the block in a `BEGIN IMMEDIATE` transaction (takes the write lock up front).

    Args:
        conn: Connection opened by `connect`.

    Yields:
        Nothing; commits on normal exit, rolls back on any exception.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")

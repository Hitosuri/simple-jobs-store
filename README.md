# simple-jobs-store

A small at-least-once job queue over HTTP. Providers submit jobs, workers claim them under a
lease, heartbeat while running, and report success or failure. Expired leases are revoked
and retried with exponential backoff. Backed by a single SQLite file.

- Building a worker? Read [**WORKER.md**](WORKER.md).
- How the store decides claim order, retries and attempts: [be/README.md](be/README.md).
- Interactive API docs: `http://127.0.0.1:8000/docs` once the server is running.

## Repo layout


| Path           | What                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `be/`          | Store: Python 3.11, FastAPI, SQLite (stdlib `sqlite3`), managed by `uv` |
| `fe/`          | Not created yet                                                         |
| `.env.example` | Config template, copy to `.env`                                         |
| `WORKER.md`    | Worker developer guide                                                  |
| `worker-example/` | Runnable Python worker (stdlib only)                                 |


## Quick start

Requires [uv](https://docs.astral.sh/uv/). Run from the repo root.

```bash
cp .env.example .env
uv run --directory be --env-file ../.env main.py
```

The server listens on `http://127.0.0.1:8000`. The schema is created on first start in
`be/jobs.db` (relative paths resolve from `be/`).

Submit a job and look at it:

```bash
curl -X POST http://127.0.0.1:8000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "resize", "description": {"url": "a.png"}, "maxAttempt": 3}'

curl http://127.0.0.1:8000/api/jobs/1
```

## Configuration

Environment variables, all optional (defaults in `.env.example`). Durations are milliseconds.


| Variable                         | Default     | Meaning                                  |
| -------------------------------- | ----------- | ---------------------------------------- |
| `JOBS_STORE_HOST`                | `127.0.0.1` | Bind address                             |
| `JOBS_STORE_PORT`                | `8000`      | Port                                     |
| `JOBS_STORE_DB_PATH`             | `jobs.db`   | SQLite file, relative to `be/`           |
| `JOBS_STORE_WORKER_LEASE_MS`     | `30000`     | Worker lease length                      |
| `JOBS_STORE_JOB_LEASE_MS`        | `30000`     | Job lease length                         |
| `JOBS_STORE_DEFAULT_MAX_RUN_MS`  | `86400000`  | Per-claim deadline when a job sets none  |
| `JOBS_STORE_DEFAULT_MAX_ATTEMPT` | `3`         | Attempts when a job sets none            |
| `JOBS_STORE_BACKOFF_BASE_MS`     | `1000`      | First retry delay (doubles each attempt) |
| `JOBS_STORE_BACKOFF_CAP_MS`      | `300000`    | Max retry delay                          |
| `JOBS_STORE_CLEANUP_INTERVAL_MS` | `5000`      | How often expired leases are revoked     |
| `JOBS_STORE_RETENTION_MS`        | `604800000` | Finished jobs are deleted after this     |


## API overview

All routes are under `/api` and return `{"ok": true, "data": ...}` or
`{"ok": false, "error": {"code", "message", "details"}}`. JSON keys are camelCase.


| Method | Path                                | Used by  | Purpose                                                         |
| ------ | ----------------------------------- | -------- | --------------------------------------------------------------- |
| POST   | `/api/jobs`                         | provider | Submit `{type, description, maxAttempt?, maxRunMs?, priority?}` |
| GET    | `/api/jobs?status=&type=&limit=`    | anyone   | List jobs, newest first                                         |
| GET    | `/api/jobs/{id}`                    | anyone   | Job + attempt history                                           |
| POST   | `/api/jobs/{id}/cancel`             | provider | Cancel a pending or running job                                 |
| PUT    | `/api/workers/{workerId}`           | worker   | Register                                                        |
| POST   | `/api/workers/{workerId}/heartbeat` | worker   | Keep worker alive                                               |
| GET    | `/api/workers`                      | anyone   | List workers                                                    |
| POST   | `/api/jobs/claim`                   | worker   | Claim next job of a type                                        |
| POST   | `/api/jobs/{id}/heartbeat`          | worker   | Extend job lease                                                |
| POST   | `/api/jobs/{id}/finish`             | worker   | Report success or failure                                       |
| POST   | `/api/jobs/{id}/release`            | worker   | Give a job back without using an attempt                        |


Worker-side details (lease rules, error codes, retries, reference code): [WORKER.md](WORKER.md).

## Limitations

- No authentication; worker ids are self-declared. Don't expose the store publicly.
- Single process, single SQLite file.
- No size limits on job payloads yet.

## Development

```bash
uv run --directory be pytest
uv run --directory be ruff format .
uv run --directory be ruff check .
uv run --directory be ty check
```


# simple-jobs-store

A small at-least-once job queue over HTTP. Providers submit jobs, workers claim them under a
lease, heartbeat while running, and report success or failure. Expired leases are revoked
and retried with exponential backoff. Backed by a single SQLite file.

- Submitting jobs or receiving callbacks? Read [**PROVIDER.md**](PROVIDER.md).
- Building a worker? Read [**WORKER.md**](WORKER.md).
- How the store decides claim order, retries and attempts: [be/README.md](be/README.md).
- Getting job results pushed to you (`reports` callbacks): [be/README.md §8](be/README.md#8-reports-to-providers).
- Interactive API docs: `http://127.0.0.1:8000/docs` once the server is running.

## Repo layout


| Path           | What                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `be/`          | Store: Python 3.11, FastAPI, SQLite (stdlib `sqlite3`), managed by `uv` |
| `fe/`          | Not created yet                                                         |
| `.env.example` | Config template, copy to `.env`                                         |
| `PROVIDER.md`  | Provider guide: submitting jobs, callbacks                              |
| `WORKER.md`    | Worker developer guide                                                  |
| `worker-example/` | Runnable Python worker (stdlib only)                                 |
| `compose.yaml` | Docker Compose deploy of `be/` (image from `be/Dockerfile`)            |


## Quick start

Requires [uv](https://docs.astral.sh/uv/). Run from the repo root.

```bash
cp .env.example .env
mkdir -p data
uv run --project be --env-file .env be/main.py
```

The server listens on `http://127.0.0.1:8000`. The schema is created on first start in
`data/jobs.db` (`JOBS_STORE_DATA_DIR`; relative paths resolve from the repo root).

Submit a job and look at it:

```bash
curl -X POST http://127.0.0.1:8000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "resize", "description": {"url": "a.png"}, "maxAttempt": 3}'

curl http://127.0.0.1:8000/api/jobs/1
```

### Docker

```bash
cp .env.example .env                       # set JOBS_STORE_DATA_DIR
mkdir -p ./data && sudo chown 999:999 ./data   # same dir; chown on Linux only (container uid 999)
docker compose up -d --build
```

Published on `JOBS_STORE_HOST:JOBS_STORE_PORT` of the host (`127.0.0.1:8000` by default; set
`JOBS_STORE_HOST=0.0.0.0` to reach it from other machines). The database is `jobs.db` (plus
`-wal` / `-shm` while running) in `JOBS_STORE_DATA_DIR`. Compose refuses to start if that directory
doesn't exist. Keep it on a local disk: SQLite WAL needs working file locks.

## Configuration

Environment variables, all optional (defaults in `.env.example`). Durations are milliseconds.


| Variable                         | Default     | Meaning                                  |
| -------------------------------- | ----------- | ---------------------------------------- |
| `JOBS_STORE_HOST`                | `127.0.0.1` | Bind address                             |
| `JOBS_STORE_PORT`                | `8000`      | Port                                     |
| `JOBS_STORE_DATA_DIR`            | `data`      | Directory holding `jobs.db`; must exist  |
| `JOBS_STORE_WORKER_LEASE_MS`     | `30000`     | Worker lease length                      |
| `JOBS_STORE_JOB_LEASE_MS`        | `30000`     | Job lease length                         |
| `JOBS_STORE_DEFAULT_MAX_RUN_MS`  | `86400000`  | Per-claim deadline when a job sets none  |
| `JOBS_STORE_DEFAULT_MAX_ATTEMPT` | `3`         | Attempts when a job sets none            |
| `JOBS_STORE_BACKOFF_BASE_MS`     | `1000`      | First retry delay (doubles each attempt) |
| `JOBS_STORE_BACKOFF_CAP_MS`      | `300000`    | Max retry delay                          |
| `JOBS_STORE_CLEANUP_INTERVAL_MS` | `5000`      | How often expired leases are revoked     |
| `JOBS_STORE_RETENTION_MS`        | `604800000` | Finished jobs are deleted after this     |
| `JOBS_STORE_REPORT_MAX_ROUNDS`      | `3`         | Passes over a job's report methods before giving up |
| `JOBS_STORE_REPORT_TIMEOUT_MS`      | `10000`     | Timeout of each network operation in a report send (connect / write / read of the status line), not a total deadline |
| `JOBS_STORE_REPORT_BACKOFF_BASE_MS` | `10000`     | Delay before the first report retry (doubles)       |
| `JOBS_STORE_REPORT_BACKOFF_CAP_MS`  | `600000`    | Max report retry delay                              |

## API overview

All routes are under `/api` and return `{"ok": true, "data": ...}` or
`{"ok": false, "error": {"code", "message", "details"}}`. JSON keys are camelCase.


| Method | Path                                | Used by  | Purpose                                                         |
| ------ | ----------------------------------- | -------- | --------------------------------------------------------------- |
| POST   | `/api/jobs`                         | provider | Submit `{type, description, maxAttempt?, maxRunMs?, priority?, reports?}` |
| GET    | `/api/jobs?status=&type=&page=&pageSize=` | anyone | List jobs, newest first, paginated                          |
| GET    | `/api/jobs/{id}`                    | anyone   | Job + attempt history                                           |
| POST   | `/api/jobs/{id}/cancel`             | provider | Cancel a pending or running job                                 |
| PUT    | `/api/workers/{workerId}`           | worker   | Register                                                        |
| POST   | `/api/workers/{workerId}/heartbeat` | worker   | Keep worker alive                                               |
| GET    | `/api/workers`                      | anyone   | List workers                                                    |
| POST   | `/api/jobs/claim`                   | worker   | Claim next job of a type                                        |
| POST   | `/api/jobs/{id}/heartbeat`          | worker   | Extend job lease, optionally report progress                    |
| POST   | `/api/jobs/{id}/finish`             | worker   | Report success or failure                                       |
| POST   | `/api/jobs/{id}/release`            | worker   | Give a job back without using an attempt                        |


Worker-side details (lease rules, error codes, retries, reference code): [WORKER.md](WORKER.md).

## Limitations

- No authentication; worker ids are self-declared. Don't expose the store publicly.
- Single process, single SQLite file.
- No size limits on job payloads yet.
- Report callbacks go to any URL a provider gives, including internal addresses.

## Development

```bash
uv run --directory be pytest
uv run --directory be ruff format .
uv run --directory be ruff check .
uv run --directory be ty check
```


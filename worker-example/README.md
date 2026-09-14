# worker-example

Minimal reference worker for `simple-jobs-store`, a single file: [`worker.py`](worker.py).
Python 3 standard library only, nothing to install. Protocol and rules: [`WORKER.md`](../WORKER.md).

## Run

From the repo root:

```bash
# 1. start the store (see root README)
uv run --directory be --env-file ../.env main.py

# 2. start the worker (another terminal)
python worker-example/worker.py

# 3. submit jobs of type "resize"
curl -X POST http://127.0.0.1:8000/api/jobs -H "Content-Type: application/json" \
  -d '{"type": "resize", "description": {"url": "a.png"}}'
curl -X POST http://127.0.0.1:8000/api/jobs -H "Content-Type: application/json" \
  -d '{"type": "resize", "description": {"fail": true}, "maxAttempt": 1}'

# 4. check the results (ids 1 and 2 assume an empty database)
curl http://127.0.0.1:8000/api/jobs/1   # status "success", result {"echo": {"url": "a.png"}}
curl http://127.0.0.1:8000/api/jobs/2   # status "failed", error "ValueError"
```

The store URL comes from the `STORE_URL` env var (default `http://127.0.0.1:8000/api`).

## What it does

| Function | Role |
|---|---|
| `call()` | Sends a request, unwraps the `{ok, data, error}` envelope, raises `ApiError(code)` on errors |
| `main()` | Registers, starts the worker heartbeat, then loops: claim → `run()`, sleeping when there is no job |
| `keep_worker_alive()` | Worker heartbeat every 10 s; re-registers on `WORKER_NOT_FOUND` |
| `run()` | Starts a job heartbeat thread and runs `handle()`. Then it reports `success`, or `failed` if `handle()` raised; it skips finish if the lease was lost, and releases the job on Ctrl+C |
| `handle()` | Demo job logic: sleeps 1 s and echoes `description`, or raises if `description.fail` is true |

Worker id is `hostname-pid`, so several copies can run side by side.

## Make it yours

1. Replace `handle(description, lost)` with your job logic. Keep it idempotent, and stop early
   when `lost.is_set()`.
2. Set `JOB_TYPE` and the `name` in `register()`.
3. Whatever `handle()` returns is the `result` (must be JSON-serialisable). An exception
   becomes `error` (exception class name) + `errorDetail` (message).

## Not included

Add these before production use:

- a local deadline timer (`job.maxRunMs`);
- running several jobs in parallel;
- a heartbeat interval derived from `leaseMsRemaining` (hardcoded 10 s fits the default 30 s leases);
- backoff on `INTERNAL_ERROR`;
- release on `SIGTERM` (only Ctrl+C is handled).

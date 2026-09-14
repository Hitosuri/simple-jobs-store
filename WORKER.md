# Writing a worker

A worker claims jobs from `simple-jobs-store`, runs them, and reports back. Any language that
speaks HTTP + JSON works.

- Runnable example: [`worker-example/worker.py`](worker-example/worker.py)
- How the store decides claim order, retries and attempts: [`be/README.md`](be/README.md)
  (not needed to write a worker)
- OpenAPI UI: `http://<host>:<port>/docs`

## 1. Flow

```
start ──> PUT /workers/{id}                                  register
          ├── every ~10 s: POST /workers/{id}/heartbeat
          └── loop: POST /jobs/claim {workerId, type}
                data == null  ──> sleep 1-2 s, retry
                data == claim ──> run job
                    every ~10 s: POST /jobs/{jobId}/heartbeat {workerId, leaseToken}
                        LEASE_REJECTED / JOB_NOT_FOUND ──> stop, don't finish
                    done     ──> POST /jobs/{jobId}/finish {status: "success", result}
                    error    ──> POST /jobs/{jobId}/finish {status: "failed", error, errorDetail}
                    shutdown ──> POST /jobs/{jobId}/release
```

## 2. Rules

- **Handler must be idempotent.** A job can run again after:
  - a reported failure,
  - a crash,
  - a passed deadline,
  - your lease expiring and another worker claiming the job. In this case two workers can
    briefly run the same job at once.
- **Pull only.** Poll claim. There is no push, long-poll, or callback.
- **Worker id unique per process** (e.g. `hostname-pid`). No auth; the id is whatever you send.
  Register is an upsert, so calling it again is safe.
- **Two leases, both 30 s by default:**
  - *Worker lease* says the process is alive. **Only claim checks it.** Job heartbeat, finish
    and release keep working after it expires.
  - *Job lease* says you still hold a job. Every job call carries `workerId` + `leaseToken`.
- **Heartbeat interval = `leaseMsRemaining / 3`** from each response (10 s with defaults). Send
  one for the worker, and one for each running job.
- **Keep a margin on the lease.** Under load, `leaseMsRemaining` can overstate the time left by
  up to ~5 s.
- **Deadline: each claim may run for at most `job.maxRunMs`.**
  - Heartbeats can't extend it. After it, every job call returns `LEASE_REJECTED`.
  - The store sends no countdown. Take `time.monotonic()` (or your language's equivalent) when
    claim returns, and stop once elapsed reaches `maxRunMs` minus a margin.
- **Never compare `leaseUntil` / `deadlineAt` with your wall clock** (clock skew). Use them for
  logs only.
- **An expired lease is not a lost job.** Keep working, keep heartbeating, and finish as normal.
  The job is still yours if the deadline hasn't passed and nobody has claimed it since your
  lease expired (neither another worker nor you with a new claim). Only `LEASE_REJECTED` means
  it's gone. Release is the exception: it does not work once the lease has expired.
- **One claim = one job.** `concurrentLimit` is display only. For N parallel jobs, run N claim loops.
- **`leaseToken` only comes back from claim**, never from job reads. Keep it in memory. After a
  crash you can't resume; held jobs retry on their own. On restart, just register and claim.
- **Cancel is not pushed.** A job cancelled mid-run keeps running on your side until its next
  heartbeat returns `LEASE_REJECTED`. The heartbeat interval is the worst-case wasted work.
- **Retries are the store's job.**
  - Report `failed` and move on; the store retries with backoff until `maxAttempt`. There is
    no "don't retry" flag: a permanent error (e.g. corrupt input) is retried too. Jobs that
    must not be retried need `maxAttempt: 1` from the provider.
  - On shutdown, `release` unfinished jobs instead of failing them: release doesn't use an
    attempt, and the job becomes available again immediately.

## 3. API

Base `/api`. JSON keys camelCase (snake_case request keys are also accepted). Timestamps ISO
8601 UTC: `2026-09-14T05:39:39.562Z`, and the ms part is dropped when zero (`...08:00:00Z`).
Durations are integer ms. `description` / `result` accept any JSON; `NaN` / `Infinity` are
rejected with 422.

Every response:

```json
{"ok": true, "data": ...}
{"ok": false, "error": {"code": "LEASE_REJECTED", "message": "lease token rejected", "details": null}}
```

Branch on `ok` and `error.code`, not on HTTP status or `message`.

| Call | Body | `data` |
|---|---|---|
| `PUT /workers/{workerId}` | `name` (non-empty), `concurrentLimit` (≥ 1) | worker |
| `POST /workers/{workerId}/heartbeat` | - | `leaseUntil, leaseMsRemaining` |
| `POST /jobs/claim` | `workerId, type` | claim, or `null` if nothing to do |
| `POST /jobs/{jobId}/heartbeat` | `workerId, leaseToken` | `leaseUntil, leaseMsRemaining, deadlineAt` |
| `POST /jobs/{jobId}/finish` | `status: "success", workerId, leaseToken, result?` (default `null`) | job |
| | `status: "failed", workerId, leaseToken, error` (non-empty), `errorDetail?` | job |
| `POST /jobs/{jobId}/release` | `workerId, leaseToken` | `null` |
| `GET /jobs/{jobId}` | - | `{job, attempts}` |

Claim `data` (job trimmed):

```json
{
  "job": {"id": 1, "type": "resize", "description": {"url": "a.png"}, "maxRunMs": 86400000,
          "status": "running", "attempt": 1, "maxAttempt": 3, "error": null},
  "leaseToken": "oC8YwpUWMw4R8AciJGGB8Q3q0udm1q77",
  "leaseUntil": "2027-01-15T08:00:30Z",
  "leaseMsRemaining": 30000,
  "deadlineAt": "2027-01-16T08:00:00Z"
}
```

**Job fields:** `id, type, description, maxRunMs, workerId, leaseUntil, deadlineAt, availableAt,
priority, status, attempt, maxAttempt, error, errorDetail, result, createdAt, updatedAt,
startedAt, finishedAt`.

What each worker call means in practice:

- **Claim:** one type per call; for several types, call it once per type. The store picks the
  job, and you can't choose. `description` is your input. If `job.attempt > 1`, this job was
  claimed before (releases count too), and `job.error` / `errorDetail` may hold the previous
  attempt's error.
- **Finish:** returns the job. After `failed` its status is `pending` (the store will retry) or
  `failed` (out of attempts). Nothing to do either way.
- **Release:** job back to `pending` immediately.
- **`GET /jobs/{jobId}`:** check a job's outcome after a lost response.

Provider and listing endpoints: [README](README.md#api-overview).

## 4. Errors

| Code | HTTP | Returned by | Action |
|---|---|---|---|
| `WORKER_NOT_FOUND` | 404 | worker heartbeat, claim | Register again |
| `WORKER_LEASE_EXPIRED` | 409 | claim | Heartbeat or register, then claim again |
| `LEASE_REJECTED` | 409 | job heartbeat, finish, release | **Stop the job, don't finish, don't release.** It was cancelled, is past its deadline, was claimed by someone else after your lease expired, or is already finished (e.g. your earlier finish landed) |
| `JOB_NOT_FOUND` | 404 | job calls | Stop the job (purged, 7 days after finishing by default) |
| `VALIDATION_ERROR` | 422 | any | Body or params break a rule from §3 (e.g. empty `error`, `NaN` in `result`). Fix the request; `details` = list of `{type, loc, msg, input}`. Your lease is untouched |
| `INTERNAL_ERROR` | 500 | any | Retry later with backoff |
| `ROUTE_NOT_FOUND` / `METHOD_NOT_ALLOWED` | 404 / 405 | any | Wrong URL or method |

Lost responses and outages:

- **Store unreachable:** keep retrying heartbeats. See §2, "An expired lease is not a lost job".
- **Finish / release:** retry. `LEASE_REJECTED` on the retry means the first call landed:
  treat it as done. `GET /jobs/{jobId}` shows which outcome won.
- **Claim:** nothing to do. A job claimed for you that you never saw retries on its own once
  its lease expires (~35 s by default).

## 5. Example

[`worker-example/worker.py`](worker-example/worker.py): stdlib only, one job at a time, one type.

```bash
python worker-example/worker.py        # STORE_URL defaults to http://127.0.0.1:8000/api
```

Replace `handle()`.

- It receives a `lost` event, which the job-heartbeat thread sets on `LEASE_REJECTED` /
  `JOB_NOT_FOUND`; check it to stop early.
- The heartbeat interval is hardcoded to 10 s, which fits the default 30 s leases.
- Not included: local deadline timer, parallel jobs, backoff on `INTERNAL_ERROR`, release on
  `SIGTERM` (only Ctrl+C).

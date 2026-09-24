# Submitting jobs (providers)

A provider creates jobs in `simple-jobs-store`, then learns the outcome by polling the job or by
getting a callback. Any language that speaks HTTP + JSON works.

- How the store decides claim order, retries and attempts: [`be/README.md`](be/README.md)
- Writing the worker that runs your jobs: [`WORKER.md`](WORKER.md)
- OpenAPI UI: `http://<host>:<port>/docs`

## 1. Flow

```
POST /jobs {type, description, maxAttempt?, maxRunMs?, priority?, reports?}   -> job (pending)
  │
  ├── polling:   GET /jobs/{jobId} until status is success / failed / cancelled
  ├── callbacks: the store POSTs {id, status, ...} to each reports[].config.url
  └── changed your mind: POST /jobs/{jobId}/cancel
```

## 2. Rules

- **At least once.** A job can run more than once (retries, crashes, expired leases), so the
  worker's handler must be idempotent. Your callback endpoint must be too (§5).
- **`type` routes the job.** Workers claim by exact `type`. No worker for that type = the job
  stays `pending` forever; there is no timeout for waiting to be claimed.
- **`description` is the worker's input.** Any JSON. No auth and no size limit: anyone who can
  reach the store can read it with `GET /jobs`, so don't put secrets in it.
- **`maxAttempt`** (default 3) counts failures, expiries and deadlines, not releases. For work
  that must not repeat after a failure, set `maxAttempt: 1`. There is no "don't retry" flag on the
  worker side. Even with `maxAttempt: 1` a job can start twice: a worker that shuts down cleanly
  releases its job, which goes back to `pending` without using an attempt (a crash doesn't
  release; it uses the attempt). With `maxAttempt: 1` that is the only way; callback failures
  never re-run a job. Work that must happen once
  (payments) needs its own idempotency key.
- **`maxRunMs`** (default 1 day) is the limit **per claim**, not in total. Worst case a job runs
  `maxAttempt × maxRunMs` plus the `maxAttempt − 1` waits between attempts (1 s, 2 s, 4 s …
  capped at 5 min by default): `maxAttempt: 3`, `maxRunMs: 60000` → 180 s + 1 s + 2 s ≈ 3 min.
- **`priority`** (default 0): higher is claimed first. Ties go to the job that became available
  first. A worker claims one `type` at a time, so priority never compares jobs of different types.
- **Cancel** works on `pending` and `running` jobs. A running worker only stops at its next
  heartbeat (~10 s), so side effects can still happen after cancel returns. Cancelled jobs get
  no callback.
- **Keep results within 7 days.** Finished jobs (and their attempts) are deleted
  `JOBS_STORE_RETENTION_MS` after `finishedAt`; later reads return `JOB_NOT_FOUND`. `pending` and
  `running` jobs are never deleted.
- **`failed` is not always final.** If a worker misses its heartbeats (e.g. a network blip), the
  store marks the attempt `lease_expired`, and on the last attempt the job becomes `failed`. If that
  same worker reconnects within `maxRunMs` of its claim and finishes, its result still counts and
  the job becomes `success`. Rare, but accept a later `status`.

## 3. API

Base `/api`. JSON keys camelCase (snake_case request keys are also accepted). Timestamps ISO
8601 UTC: `2026-09-14T05:39:39.562Z`, and the ms part is dropped when zero (`...08:00:00Z`).
Durations are integer ms. `NaN` / `Infinity` in `description` are rejected with 422.

Every response:

```json
{"ok": true, "data": ...}
{"ok": false, "error": {"code": "JOB_NOT_FOUND", "message": "job not found", "details": null}}
```

Branch on `ok` and `error.code`, not on HTTP status or `message`.

| Call | Body / query | `data` |
|---|---|---|
| `POST /jobs` | `type` (non-empty), `description` (JSON, required, may be `null`), `maxAttempt?` (1..100), `maxRunMs?` (1..86 400 000), `priority?` (int32), `reports?` (1..10 methods, §4) | job, HTTP 201 |
| `GET /jobs/{jobId}` | - | `{job, attempts}`, attempts oldest first |
| `GET /jobs` | `status?`, `type?`, `page?` (≥ 1, default 1), `pageSize?` (1..1000, default 100) | `{items, page, pageSize, total}`, items newest first |
| `POST /jobs/{jobId}/cancel` | - | job |

Create a job:

```bash
curl -X POST http://127.0.0.1:8000/api/jobs -H "Content-Type: application/json" -d '{
  "type": "resize",
  "description": {"url": "a.png"},
  "maxAttempt": 3,
  "reports": [{"type": "callback", "config": {"url": "https://a.example/hook"}}]
}'
```

**Job fields you care about:**

| Field | Meaning |
|---|---|
| `id` | Job id; keep it to read, cancel, and match callbacks |
| `status` | `pending`, `running`, `success`, `failed`, `cancelled` |
| `result` | Worker's result on `success`, else `null` |
| `error` / `errorDetail` | Worker's own error when it reported `failed`. A worker that crashes, is killed or loses the network reports nothing: `error` is `lease_expired`. An attempt that ran past `maxRunMs`: `deadline_exceeded`. Detail `null` for both. Cleared on `success` |
| `attempt` / `maxAttempt` | Claims so far (releases included) / attempt limit |
| `availableAt` | While `pending`: when the job can be claimed (later than now during retry backoff) |
| `startedAt` / `finishedAt` | Latest claim / when it reached `success`, `failed` or `cancelled` |
| `reports`, `reportStatus`, `reportRound`, `reportCursor`, `reportNextAt`, `reportError` | Callback delivery, §4 |
| `progress` | `null`, or the worker's steps in first-reported order: `{id, status, current, total, percent, message}`. `status` is `pending`, `running`, `done`, `failed` or `skipped`; the other keys may be `null`. Each step's `percent` is 0..100, derived from `current / total` when the worker sent none; `null` means unknown (show a spinner). No overall percent: steps differ in length. Reset on each new claim, kept after finish. Poll `GET /jobs/{id}`; not sent in callbacks |

Other fields (`workerId`, `leaseUntil`, `deadlineAt`, `createdAt`, `updatedAt`, …) are for
debugging. **Attempt:** `attemptNo, workerId, outcome, error, errorDetail, startedAt, endedAt`;
`outcome` is `succeeded`, `failed`, `lease_expired`, `deadline_exceeded`, `released`,
`cancelled`, or `null` while running.

## 4. Callbacks (`reports`)

`reports` lists where to tell you a job finished, **in backup order**: the second method is only
tried when the first fails. Only type now:

```json
{"type": "callback", "config": {"url": "https://a.example/hook"}}
```

`url` must be `http` or `https`, and reachable **from the store's host**. A bare host is stored
with a trailing slash (`https://a.example` → `https://a.example/`). `reports` is fixed at create;
there is no update. To change it on a `pending` job, cancel the job and create a new one.

**When:** the job becomes `success`, or `failed` with no attempts left. Not for `cancelled`, not
for a failure that will be retried.

**Request the store sends:** `POST <url>`, `Content-Type: application/json`, no auth header, no
signature:

```json
{
  "id": 1,
  "type": "resize",
  "status": "success",
  "startedAt": "2027-01-15T08:00:00Z",
  "finishedAt": "2027-01-15T08:00:42.125Z",
  "result": {"url": "a-small.png"},
  "error": null,
  "errorDetail": null
}
```

`status` is `success` or `failed`. Values are read from the job when the callback is sent.

**Delivered = any 2xx.** Everything else is a failed send: 3xx (redirects are not followed),
4xx, 5xx, connection errors, and timeouts (10 s per network operation, not in total). The
response body is ignored.

**Retries:** a background loop sends one callback at a time, within ~5 s
(`JOBS_STORE_CLEANUP_INTERVAL_MS`) of the job finishing. Each failed send moves to the next
method; after the last one the store starts over from the first. Before **every** send after a
failure, including moving to a backup, it waits 10 s, 20 s, 40 s … capped at 10 min. After 3
full passes over the list it gives up. With URLs A and B both down:

```
A (t=0, first send) ─10s─> B ─20s─> A ─40s─> B ─80s─> A ─160s─> B   6 sends, ~5 min, then reportStatus failed
```

If B works, it stops at the second send (~10 s): `reportStatus` = `success`.

| `reportStatus` | Meaning |
|---|---|
| `null` | No `reports`, or job not finished (or finished as `cancelled`, or will be retried) |
| `pending` | Waiting to send; `reportNextAt` = when; `reportCursor` = 0-based index of the next method; `reportRound` = full passes over the list that failed so far |
| `reporting` | A send is in flight |
| `success` | A method answered 2xx |
| `failed` | All passes failed; `reportError` holds the last failure (e.g. `HTTP 500`, `ConnectTimeout: ...`) |

There is no endpoint to resend. If `reportStatus` is `failed`, read the job with
`GET /jobs/{jobId}` instead (before retention deletes it). Don't create the job again to get a
new callback: that runs the work again.

## 5. Writing the callback endpoint

- **Answer 2xx fast, work later.** Store the body and return `200`/`204`. A handler slower than
  the 10 s timeout still runs to the end on your side, but the store counts a failure and sends the
  report again to the next method. If every send is slow, your handler runs once per send: up to
  3 × the number of methods (6 for two URLs).
- **Dedupe by `id`.** The same report can arrive more than once, and **at different URLs**: if
  the store restarts mid-send, or your 2xx is lost, it moves on to the next method.
- **Accept a later `status` for the same `id`.** A `failed` report can be followed by `success`
  (§2, last rule). Compare `finishedAt` if order matters.
- **No redirects.** Give the final URL; a `301`/`302` is a failed send.
- **No authentication.** Anyone who can reach your endpoint can POST a fake report. A secret in the
  URL (`?token=...`) doesn't help much: `GET /jobs` shows `reports` to anyone. If that matters,
  treat the callback as a hint and confirm with `GET /jobs/{id}`.

Minimal receiver (Python stdlib):

```python
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

seen: dict[int, dict] = {}


class Hook(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        report = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        seen[report["id"]] = report  # last write wins: a later success replaces failed
        self.send_response(204)
        self.end_headers()


HTTPServer(("0.0.0.0", 9000), Hook).serve_forever()
```

## 6. Errors

| Code | HTTP | Returned by | Action |
|---|---|---|---|
| `VALIDATION_ERROR` | 422 | any | Body or query breaks a rule from §3 / §4 (empty `type`, `maxAttempt: 0`, `ftp://` url, `reports: []`, 11 reports, `NaN`). Fix the request; `details` = list of `{type, loc, msg, input}` |
| `JOB_NOT_FOUND` | 404 | get, cancel | Wrong id, or purged after retention |
| `JOB_ALREADY_FINISHED` | 409 | cancel | Job is already `success`, `failed` or `cancelled`. Read it to see which |
| `INTERNAL_ERROR` | 500 | any | Retry later with backoff |
| `ROUTE_NOT_FOUND` / `METHOD_NOT_ALLOWED` | 404 / 405 | any | Wrong URL or method |

Lost responses:

- **Create:** not idempotent. Retrying can create a duplicate job. If that matters, look for it
  first with `GET /jobs?type=...` and match on `description`.
- **Cancel:** retry. `JOB_ALREADY_FINISHED` on the retry may mean the first call landed; the
  job's `status` shows which.

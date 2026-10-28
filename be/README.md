# Jobs store - behaviour

How the store (`be/`) decides claim order, retries and attempts. For providers, operators and
store developers. Worker authors only need [`WORKER.md`](../WORKER.md); run and configure: root
[`README.md`](../README.md).

Code: `store.py` (logic), `db.py` (schema), `api/` (HTTP layer), `domain.py` (types, `ErrorCode`, `Settings`).

## 1. Job states

```
pending ──claim──> running ──finish success──────────────> success
                     ├─ finish failed / lease expired / deadline passed
                     │     used < maxAttempt  ──> pending (after backoff)
                     │     used >= maxAttempt ──> failed
                     ├─ release ──────────────> pending (now, attempt not used)
                     └─ cancel ───────────────> cancelled
pending ──cancel──> cancelled
```

Leaving `running` always clears the job's `workerId`, lease token and `leaseUntil`.

## 2. Claim order

`POST /jobs/claim` picks one `pending` job of the type with `availableAt <= now`, ordered by:

1. Jobs where *the claiming worker* has any earlier attempt with outcome `failed`,
   `lease_expired`, `deadline_exceeded` or `released` go last (for that worker only). If such a
   job is the only eligible one, that worker still gets it.
2. Higher `priority` first.
3. Older `availableAt` first.
4. Lower `id` first.

All writes run under SQLite `BEGIN IMMEDIATE`, so one job never goes to two claims.

Each claim:
- creates a new attempt and increments `job.attempt` (the claim count, releases included);
- sets `deadlineAt = now + maxRunMs`;
- sets `leaseUntil = min(now + job lease, deadlineAt)`.

The claim fails with `WORKER_LEASE_EXPIRED` if the worker lease has expired. No other call
checks the worker lease.

## 3. Attempts and retries

- **Used attempts** = attempts whose outcome isn't `released`, counted when an attempt ends (the
  one ending included). `used >= maxAttempt` → job `failed`, `finishedAt` set.
- **Backoff** otherwise: `availableAt = now + min(BACKOFF_BASE_MS × 2^(used-1), BACKOFF_CAP_MS)`,
  i.e. 1 s, 2 s, 4 s … up to 5 min by default. Claim ignores the job until then.
- **Release** ends the attempt as `released`: job `pending`, `availableAt = now`, no attempt used.
- **Attempt `outcome`:** `succeeded`, `failed`, `lease_expired`, `deadline_exceeded`,
  `released`, `cancelled`; `null` while running. It is set when the attempt ends: on
  finish / release / cancel, or when expiry is detected.
- **Job `error` / `errorDetail`:**
  - after a reported failure: the worker's values;
  - after an expiry: `lease_expired` or `deadline_exceeded`, with detail `null`;
  - on success: cleared.
- **A crash or a lost claim response** ends as `lease_expired` (uses an attempt) within one job
  lease + cleanup interval, ~35 s by default.

## 4. Leases, expiry and reclaim

- **Expiry detection** (`expire_if_due`) runs first on every job heartbeat / finish / release,
  and in the cleaner every `CLEANUP_INTERVAL_MS` (5 s).
  - Past `deadlineAt` → `deadline_exceeded`. This wins over lease expiry.
  - Past `leaseUntil` → `lease_expired`.
  - A rejected call rolls back its transaction, including the expiry it detected; the cleaner
    persists it.
- **Valid lease:** job `running` with the same `workerId` + token.
- **Reclaimable:** job `pending` or `failed`, its newest attempt is `lease_expired` with the same
  `workerId` + token, and `now < deadlineAt`.
  - Heartbeat and finish reclaim: the job goes back to `running` with the same token, and the
    job's error and `finishedAt` are cleared along with the newest attempt's outcome, error and
    end time.
  - Release does not reclaim.
  - `deadline_exceeded` is never reclaimable, because reclaim doesn't reset the deadline.
- **Heartbeat** extends `leaseUntil = min(now + job lease, deadlineAt)`.
  - A valid `progress` step list is upserted by step `id` into the job's progress in the same
    transaction (known id replaced in place, new id appended). An invalid list, or one that
    would grow the job past `MAX_PROGRESS_STEPS` (100), is dropped (`progressAccepted: false`)
    without failing the heartbeat. Claim resets progress to `null`; reclaim and finish keep it.
- **`leaseMsRemaining`** is computed from `now`, which the store reads before it takes the write
  lock. Under contention it can be up to the 5 s SQLite busy timeout stale.

## 5. Cancel

`POST /jobs/{id}/cancel`:
- a `pending` job becomes `cancelled`;
- a `running` job becomes `cancelled` and its attempt ends as `cancelled`. The worker learns on
  its next job call (`LEASE_REJECTED`);
- a finished job returns `JOB_ALREADY_FINISHED`.

Cancel sets `finishedAt`.

## 6. Retention

The cleaner deletes `success` / `failed` / `cancelled` jobs whose `finishedAt` is older than
`RETENTION_MS` (7 days), together with their attempts. Later calls on them return `JOB_NOT_FOUND`.

## 7. Endpoints and limits

| Call | Body / query | `data` |
|---|---|---|
| `POST /api/jobs` | `type` (non-empty), `description` (JSON), `maxAttempt?` (1..100, default 3), `maxRunMs?` (1..86 400 000, default 1 day), `priority?` (int32, default 0), `reports?` (1..10 methods, §8) | job, HTTP 201 |
| `GET /api/jobs` | `status?` and `type?` (both repeatable), `worker?` (single), `q?` (job id, or literal substring of the description), `createdFrom?` / `createdTo?` (ISO), `sort?` (`newest` default, `oldest`, `priority`, `running_longest`), `page?` (≥ 1, default 1), `pageSize?` (1..1000, default 100) | page of jobs |
| `GET /api/jobs/counts` | same filters as `GET /api/jobs`, except `status` is ignored | `{pending, running, success, failed, cancelled}` |
| `GET /api/jobs/{id}` | - | `{job, attempts}`, attempts oldest first |
| `POST /api/jobs/{id}/cancel` | - | job |
| `POST /api/jobs/{id}/retry` | - | job (§7.1) |
| `PATCH /api/jobs/{id}` | `priority` (int32) | job (§7.1) |
| `DELETE /api/jobs/{id}` | - | `null` (§7.1) |
| `POST /api/jobs/bulk` | `action` (`cancel`, `retry`, `delete`, `priority`), `ids` (1..1000, each 1..2^63-1), `priority` (only for `priority`) | `{done: [id], skipped: [{id, code}]}` |
| `GET /api/workers` | `includeOffline?` (default `false`) | workers; by default hides those whose lease expired over 24 h ago |
| `DELETE /api/workers/{id}` | - | `null` (§7.1) |
| `GET /api/attempts` | `from`, `to` (ISO; `to` after `from`, at most 24 h apart), `worker?` | attempts overlapping the window |
| `GET /api/overview` | - | counts, worker load, pending per type, finished in the last 24 h and the 24 h before, throughput buckets, alerts, p95 run time per type |
| `GET /api/stats` | `range` (`1h`, `24h`, `7d`) | KPIs with previous-window values, finished buckets, per-type figures, top errors |

Stats buckets cover whole buckets ending with the current partial one, so they can start before the
window; the sum of the buckets can differ from `kpis.finished`, which counts only the window.

Worker calls: [`WORKER.md`](../WORKER.md) §3.

### 7.1 Operator actions

Used by the control room. Failures use the usual error envelope.

- **Retry** (`failed` or `cancelled` only, else `JOB_NOT_RETRYABLE` 409): the job goes back to
  `pending` under the same id. `requeuedAt` is set, and the `maxAttempt` budget counts only
  attempts started after it (`attemptsUsed`); older attempts stay in the history. `deadlineAt` is
  cleared, so the worker of the old attempt cannot reclaim it. `lastWorkerId` is the worker of the
  latest attempt. Report fields are reset as for a new job: the provider gets a new report when the
  job finishes again.
- **Priority** (`pending` only, else `JOB_NOT_PENDING` 409): changes `priority`.
- **Delete** (finished jobs only, else `JOB_NOT_FINISHED` 409): removes the job and its attempts. If its report is still `pending` or
  `reporting`, that report is dropped and the provider never receives it.
- **Bulk:** runs one action per id. Ids it could not apply to come back in `skipped` with the error
  code the single call would give (e.g. `JOB_NOT_FOUND`); the others are in `done`.
- **Forget worker** (`DELETE /api/workers/{id}`): only an offline worker that holds no job.
  `WORKER_CONNECTED` 409 while its lease is live, `WORKER_BUSY` 409 while any job still references it. Its attempt history stays.

Objects:
- **worker:** `id, name, ip, concurrentLimit, connectedAt, lastSeenAt, leaseUntil, leaseMsRemaining, connected`.
  `ip` is the client address of the last register or heartbeat. `connected` means `leaseUntil > now`.
- **page** (every paginated list): `items, page, pageSize, total`. `total` counts all matches;
  pages = `ceil(total / pageSize)`. Offset-based: rows inserted meanwhile shift later pages.
- **attempt:** `attemptNo, workerId, outcome, error, errorDetail, startedAt, endedAt`.
- **Never returned in reads:** the lease token.

## 8. Reports to providers

`reports` on create lists how to tell the provider a job finished, in backup order. Only type
now: `{"type": "callback", "config": {"url": "https://..."}}` - the store POSTs JSON
`{id, type, status, startedAt, finishedAt, result, error, errorDetail}` and only a 2xx counts
(redirects are not followed).

- **When:** the job becomes `success`, or `failed` with no attempts left (reported failure or
  expiry). Not for `cancelled`, not for a failure that will be retried.
- **`reportStatus`:** `null` (not finished) → `pending` → `reporting` → `success`, or back to
  `pending` after a failed send, or `failed` after `REPORT_MAX_ROUNDS` passes over the list.
- **Retries:** each failed send moves to the next method (`reportCursor`); after the last one
  `reportRound` goes up and the cursor restarts. Before every retry the store waits
  `min(REPORT_BACKOFF_BASE_MS × 2^(n-1), REPORT_BACKOFF_CAP_MS)`, `n` = failed sends so far.
  2 methods × 3 rounds = at most 6 sends. `reportError` holds the last failure.
- **Delivery:** at least once, by a background loop every `CLEANUP_INTERVAL_MS`, one send at a
  time. A send cut off by a restart counts as failed (`interrupted`). Dedupe by `id`.
- **Reclaim:** a `failed` job reclaimed by its worker clears its report; when it finishes again
  the provider is told again, possibly after an earlier `failed` report.

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
| `POST /api/jobs` | `type` (non-empty), `description` (JSON), `maxAttempt?` (1..100, default 3), `maxRunMs?` (1..86 400 000, default 1 day), `priority?` (int32, default 0) | job, HTTP 201 |
| `GET /api/jobs` | `status?`, `type?`, `limit` 1..1000 (default 100) | jobs, newest first |
| `GET /api/jobs/{id}` | - | `{job, attempts}`, attempts oldest first |
| `POST /api/jobs/{id}/cancel` | - | job |
| `GET /api/workers` | - | workers |

Worker calls: [`WORKER.md`](../WORKER.md) §3.

Objects:
- **worker:** `id, name, ip, concurrentLimit, connectedAt, lastSeenAt, leaseUntil, leaseMsRemaining, connected`.
  `ip` is the request's client address. `connected` means `leaseUntil > now`.
- **attempt:** `attemptNo, workerId, outcome, error, errorDetail, startedAt, endedAt`.
- **Never returned in reads:** the lease token.

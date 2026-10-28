import type { Attempt, Job, Worker } from '@/api/types';
import { toneClass, type Tone } from '@/features/overview/thresholds';
import { formatDuration } from '@/lib/format';
import { formatDateTime } from './timeline';

function Tile({ label, value, sub, tone = 'fg' }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold break-all tabular-nums ${toneClass[tone]}`}>{value}</p>
      {sub && <p className="text-xs break-all text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

export function Facts({ job, attempts, worker, now }: { job: Job; attempts: Attempt[]; worker?: Worker; now: number }) {
  const workerId = job.workerId ?? job.lastWorkerId;
  const unsuccessful = attempts.filter((a) => a.outcome !== null && a.outcome !== 'succeeded').length;
  const leaseLeft = job.status === 'running' && job.leaseUntil ? Date.parse(job.leaseUntil) - now : null;
  const deadlineLeft = job.status === 'running' && job.deadlineAt ? Date.parse(job.deadlineAt) - now : null;

  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile
        label={job.workerId ? 'Worker' : 'Last worker'}
        value={worker?.name ?? workerId ?? '\u{2014}'}
        sub={worker?.ip}
      />
      <Tile
        label="Lease"
        value={leaseLeft === null ? '\u{2014}' : leaseLeft > 0 ? formatDuration(leaseLeft) : 'expired'}
        sub={leaseLeft === null ? undefined : 'remaining'}
        tone={leaseLeft !== null && leaseLeft <= 0 ? 'bad' : 'fg'}
      />
      <Tile
        label="Attempts"
        value={`${job.attemptsUsed} / ${job.maxAttempt}`}
        sub={unsuccessful > 0 ? `${unsuccessful} unsuccessful` : undefined}
      />
      <Tile
        label="Deadline"
        value={
          deadlineLeft !== null
            ? deadlineLeft > 0
              ? formatDuration(deadlineLeft)
              : 'overdue'
            : job.deadlineAt
              ? formatDateTime(job.deadlineAt)
              : '\u{2014}'
        }
        sub={`priority ${job.priority}`}
        tone={deadlineLeft !== null && deadlineLeft <= 0 ? 'bad' : 'fg'}
      />
    </div>
  );
}

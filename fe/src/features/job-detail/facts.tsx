import type { Job } from '@/api/types';
import { formatClock, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { spanText } from './wording';

function Row({ label, value, note, bad }: { label: string; value: string; note?: string | null; bad?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 tabular-nums">
        <span className={cn(bad && 'text-bad')}>{value}</span>
        {note && <span className="ml-1.5 text-muted-foreground">{note}</span>}
      </dd>
    </>
  );
}

export function Facts({ job, now }: { job: Job; now: number }) {
  const running = job.status === 'running';
  const leaseMs = running && job.leaseUntil ? Date.parse(job.leaseUntil) - now : null;
  const deadlineMs = running && job.deadlineAt ? Date.parse(job.deadlineAt) - now : null;

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border bg-card px-3 py-2.5 text-[13px]">
      <Row label="Created" value={formatClock(job.createdAt)} />
      {job.startedAt && (
        <Row
          label={job.status === 'pending' ? 'Last started' : 'Started'}
          value={formatClock(job.startedAt)}
          note={job.status === 'pending' ? null : spanText('queued for', job.availableAt, job.startedAt)}
        />
      )}
      {job.finishedAt && <Row label="Finished" value={formatClock(job.finishedAt)} />}
      {leaseMs !== null && (
        <Row
          label="Lease"
          value={leaseMs > 0 ? `${formatDuration(leaseMs)} left` : 'Expired'}
          note={leaseMs > 0 ? 'until the worker must check in' : 'the job will be retried'}
          bad={leaseMs <= 0}
        />
      )}
      {deadlineMs !== null && job.deadlineAt && (
        <Row
          label="Deadline"
          value={formatClock(job.deadlineAt)}
          note={deadlineMs > 0 ? `in ${formatDuration(deadlineMs)}` : 'passed'}
          bad={deadlineMs <= 0}
        />
      )}
      <Row label="Priority" value={String(job.priority)} />
    </dl>
  );
}

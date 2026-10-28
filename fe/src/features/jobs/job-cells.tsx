import { Link } from '@tanstack/react-router';
import type { Job, Worker } from '@/api/types';
import { elapsedTone } from '@/features/overview/thresholds';
import { formatAgo, formatDuration } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';

export interface ListProps {
  jobs: Job[];
  now: number;
  p95: Record<string, number>;
  workers: Map<string, Worker>;
  selected: Set<number>;
  openId?: number;
  onToggle: (id: number) => void;
}

export function jobProgress(job: Job): number | null {
  const steps = job.progress;
  if (!steps?.length) return null;
  const sum = steps.reduce((n, s) => n + (s.percent ?? (s.status === 'done' || s.status === 'skipped' ? 100 : 0)), 0);
  return Math.round(sum / steps.length);
}

export function OpenLink({ id, className }: { id: number; className?: string }) {
  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: String(id) }}
      search={(prev) => prev}
      onClick={(e) => e.stopPropagation()}
      className={cn('tabular-nums hover:underline', className)}
    >
      #{id}
    </Link>
  );
}

export function TypeChip({ type }: { type: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" style={{ color: typeColorVar(type) }}>
      <span aria-hidden className="h-3 w-1 shrink-0 rounded-[1px] bg-current" />
      <span className="truncate text-foreground">{type}</span>
    </span>
  );
}

export function Elapsed({ job, now, p95 }: { job: Job; now: number; p95: Record<string, number> }) {
  if (job.status === 'running' && job.startedAt) {
    const ms = now - Date.parse(job.startedAt);
    const warn = elapsedTone(ms, p95[job.type]) === 'warn';
    return <span className={cn('tabular-nums', warn && 'font-semibold text-warn')}>{formatDuration(ms)}</span>;
  }
  if (job.finishedAt)
    return <span className="text-muted-foreground tabular-nums">{formatAgo(job.finishedAt, now)}</span>;
  if (job.status === 'pending') {
    return (
      <span className="text-muted-foreground tabular-nums">
        waiting {formatDuration(now - Date.parse(job.availableAt))}
      </span>
    );
  }
  return <span className="text-muted-foreground">{'-'}</span>;
}

export function Progress({ job }: { job: Job }) {
  const pct = jobProgress(job);
  if (pct === null) return <span className="text-muted-foreground">{'-'}</span>;
  return (
    <span className="flex items-center gap-2" style={{ color: typeColorVar(job.type) }}>
      <span aria-hidden className="h-1 w-14 overflow-hidden rounded-full bg-border">
        <span className="block h-full rounded-full bg-current" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
    </span>
  );
}

export function workerOf(job: Job, workers: Map<string, Worker>) {
  const id = job.workerId ?? job.lastWorkerId;
  if (!id) return null;
  const w = workers.get(id);
  return { name: w?.name ?? id, ip: w?.ip };
}

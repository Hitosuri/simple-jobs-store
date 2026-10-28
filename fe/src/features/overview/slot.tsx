import { Link } from '@tanstack/react-router';
import type { RunningJob } from '@/api/types';
import { formatDuration } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';
import { elapsedTone } from './thresholds';

export function Slot({ job, now, p95 }: { job?: RunningJob; now: number; p95?: number }) {
  if (!job) {
    return (
      <span className="min-h-11 min-w-[132px] rounded-md border border-dashed border-border md:h-[30px] md:min-h-0">
        <span className="sr-only">Idle slot</span>
      </span>
    );
  }
  const elapsed = now - Date.parse(job.startedAt);
  const pct = job.progressPercent;
  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: String(job.id) }}
      style={{ color: typeColorVar(job.type) }}
      className="relative flex min-h-11 min-w-[132px] items-center gap-1.5 rounded-md border border-border bg-inset px-2 pb-[3px] text-xs hover:border-ring md:h-[30px] md:min-h-0"
    >
      <span aria-hidden className="h-3 w-1 shrink-0 rounded-[1px] bg-current" />
      <span className="truncate text-foreground">{job.type}</span>
      <span
        className={cn(
          'ml-auto shrink-0 tabular-nums',
          elapsedTone(elapsed, p95) === 'warn' ? 'font-semibold text-warn' : 'text-muted-foreground',
        )}
      >
        {formatDuration(elapsed)}
      </span>
      {pct !== null && (
        <span aria-hidden className="absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-border">
          <span className="block h-full rounded-full bg-current" style={{ width: `${Math.min(pct, 100)}%` }} />
        </span>
      )}
    </Link>
  );
}

export function SlotDot({ job, now }: { job?: RunningJob; now?: number }) {
  const base = 'block h-3.5 w-[9px] shrink-0 rounded-[3px]';
  if (!job) return <span aria-hidden className={cn(base, 'border border-dashed border-border')} />;
  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: String(job.id) }}
      title={`${job.type} #${job.id}${now ? ` · ${formatDuration(now - Date.parse(job.startedAt))}` : ''}`}
      aria-label={`${job.type} job ${job.id}`}
      className={base}
      style={{ background: typeColorVar(job.type) }}
    />
  );
}

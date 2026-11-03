import type { Job, JobStatus } from '@/api/types';
import { StatusBadge } from '@/components/status-badge';
import { elapsedTone, toneClass } from '@/features/overview/thresholds';
import { formatDuration } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';
import { errorText, heroElapsed } from './wording';

const TONE: Record<JobStatus, string> = {
  pending: 'var(--muted-foreground)',
  running: 'var(--run)',
  success: 'var(--ok)',
  failed: 'var(--bad)',
  cancelled: 'var(--muted-foreground)',
};

export function Hero({
  job,
  now,
  p95,
  retry,
}: {
  job: Job;
  now: number;
  p95?: number;
  retry: { lead: string; next: string } | null;
}) {
  const { ms, label } = heroElapsed(job, now);
  const slow = job.status === 'running' && ms !== null && elapsedTone(ms, p95) === 'warn';
  const tone = TONE[job.status];
  const lead = retry?.lead ?? (job.status === 'failed' && job.error ? errorText(job.error) : null);

  return (
    <section
      className="rounded-lg border p-4"
      style={{
        borderColor: `color-mix(in oklab, ${tone} 28%, transparent)`,
        background: `radial-gradient(130% 90% at 0% 0%, color-mix(in oklab, ${tone} 22%, transparent), transparent 65%), var(--card)`,
      }}
    >
      <div className="flex items-start gap-2 text-base font-semibold">
        <span className="flex min-w-0 items-start gap-1.5" style={{ color: typeColorVar(job.type) }}>
          <span aria-hidden className="mt-1 h-4 w-1 shrink-0 rounded-[1px] bg-current" />
          <span className="min-w-0 break-all text-foreground">{job.type}</span>
        </span>
        <span className="ml-auto shrink-0">
          <StatusBadge status={job.status} />
        </span>
      </div>
      {lead && <p className="mt-2 line-clamp-3 text-sm font-medium break-words text-foreground">{lead}</p>}
      {retry && <p className="mt-1 text-xs text-muted-foreground tabular-nums">{retry.next}</p>}
      <p className="mt-3 text-xs text-muted-foreground">{label}</p>
      {ms !== null && (
        <p
          className={cn(
            'mt-1 leading-none font-semibold tracking-tight tabular-nums',
            lead ? 'text-xl' : 'text-[32px]',
            toneClass[slow ? 'warn' : 'fg'],
          )}
        >
          {formatDuration(ms)}
        </p>
      )}
      {slow && <p className="mt-1 text-xs text-warn">Slower than 95% of {job.type} jobs</p>}
    </section>
  );
}

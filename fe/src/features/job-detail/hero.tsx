import type { Job, JobStatus } from '@/api/types';
import { StatusBadge } from '@/components/status-badge';
import { elapsedTone, toneClass } from '@/features/overview/thresholds';
import { jobProgress } from '@/features/jobs/job-cells';
import { formatDuration } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';

const TONE: Record<JobStatus, string> = {
  pending: 'var(--muted-foreground)',
  running: 'var(--run)',
  success: 'var(--ok)',
  failed: 'var(--bad)',
  cancelled: 'var(--muted-foreground)',
};

function elapsedOf(job: Job, now: number): { ms: number | null; label: string } {
  if (job.status === 'running' && job.startedAt) return { ms: now - Date.parse(job.startedAt), label: 'running' };
  if (job.status === 'pending') return { ms: now - Date.parse(job.availableAt), label: 'waiting' };
  if (job.startedAt && job.finishedAt) {
    return { ms: Date.parse(job.finishedAt) - Date.parse(job.startedAt), label: 'ran for' };
  }
  return { ms: null, label: 'never started' };
}

export function Hero({ job, now, p95 }: { job: Job; now: number; p95?: number }) {
  const { ms, label } = elapsedOf(job, now);
  const slow = job.status === 'running' && ms !== null && elapsedTone(ms, p95) === 'warn';
  const steps = job.progress ?? [];
  const pct = jobProgress(job);
  const doneSteps = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const tone = TONE[job.status];

  return (
    <section
      className="rounded-lg border p-4"
      style={{
        borderColor: `color-mix(in oklab, ${tone} 28%, transparent)`,
        background: `radial-gradient(130% 90% at 0% 0%, color-mix(in oklab, ${tone} 22%, transparent), transparent 65%), var(--card)`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">#{job.id}</span>
        <span className="ml-auto">
          <StatusBadge status={job.status} />
        </span>
      </div>
      <div className="mt-1 flex items-start gap-1.5 font-semibold" style={{ color: typeColorVar(job.type) }}>
        <span aria-hidden className="mt-0.5 h-4 w-1 shrink-0 rounded-[1px] bg-current" />
        <span className="min-w-0 text-base break-all text-foreground">{job.type}</span>
      </div>
      <p
        className={cn(
          'mt-2.5 text-[32px] leading-none font-semibold tracking-tight tabular-nums',
          toneClass[slow ? 'warn' : 'fg'],
        )}
      >
        {ms === null ? '\u{2014}' : formatDuration(ms)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {label}
        {slow && ` · slower than 95% of ${job.type} jobs`}
      </p>
      {steps.length > 0 && (
        <>
          <div className="mt-3 flex gap-0.5" role="img" aria-label={`Overall progress ${pct ?? 0}%`}>
            {steps.map((s) => {
              const fill =
                s.status === 'done' || s.status === 'skipped' || s.status === 'failed' ? 100 : (s.percent ?? 0);
              return (
                <span key={s.id} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-inset">
                  <span
                    className={cn(
                      'block h-full',
                      s.status === 'failed' ? 'bg-bad' : s.status === 'running' ? 'bg-run' : 'bg-ok',
                    )}
                    style={{ width: `${fill}%` }}
                  />
                </span>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {doneSteps}/{steps.length} steps &middot; {pct ?? 0}%
          </p>
        </>
      )}
    </section>
  );
}

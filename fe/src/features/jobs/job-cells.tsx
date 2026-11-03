import { Link } from '@tanstack/react-router';
import type { Job, JobStatus, ProgressStep, StepStatus, Worker } from '@/api/types';
import { elapsedTone } from '@/features/overview/thresholds';
import { formatClock, formatDuration } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';

export interface ListProps {
  jobs: Job[];
  now: number;
  p95: Record<string, number>;
  workers: Map<string, Worker>;
  selected: Set<number>;
  openId?: number;
  statusFilter?: JobStatus[];
  onToggle: (id: number) => void;
}

export const DASH = '-';

export function attemptsShown(job: Pick<Job, 'attemptsUsed' | 'status'>): number {
  return job.attemptsUsed + (job.status === 'running' ? 1 : 0);
}

export type ShownStepStatus = StepStatus | 'stopped';

/**
 * A step the worker last reported as running is stale once the job stopped running. A succeeded job
 * finished every step even when its last heartbeat came before the final one.
 */
export function shownStepStatus(step: StepStatus, job: JobStatus): ShownStepStatus {
  if (job === 'success' && (step === 'running' || step === 'pending')) return 'done';
  return step === 'running' && job !== 'running' ? 'stopped' : step;
}

/** Overall percent; null when there is nothing current to show (no steps, or a pending job's old run). */
export function jobProgress(job: Pick<Job, 'status' | 'progress'>): number | null {
  const steps = job.progress;
  if (!steps?.length || job.status === 'pending') return null;
  if (job.status === 'success') return 100;
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
      <span title={type} className="truncate text-foreground">
        {type}
      </span>
    </span>
  );
}

type Timed = Pick<Job, 'status' | 'startedAt' | 'finishedAt' | 'availableAt'>;

/**
 * Run time so far (running), total run time (finished), time spent waiting (pending), or time left
 * before a delayed pending job can be claimed (ready); null if it never ran.
 */
export function jobDuration(
  job: Timed,
  now: number,
): { kind: 'running' | 'finished' | 'waiting' | 'ready'; ms: number } | null {
  if (job.status === 'pending') {
    const ms = now - Date.parse(job.availableAt);
    return ms < 0 ? { kind: 'ready', ms: -ms } : { kind: 'waiting', ms };
  }
  if (!job.startedAt) return null;
  if (job.status === 'running') return { kind: 'running', ms: now - Date.parse(job.startedAt) };
  if (!job.finishedAt) return null;
  return { kind: 'finished', ms: Date.parse(job.finishedAt) - Date.parse(job.startedAt) };
}

/** Step to name next to the bar: the one running now, or the one the job stopped at. */
export function currentStep(job: Pick<Job, 'status' | 'progress'>): ProgressStep | undefined {
  const steps = job.progress ?? [];
  if (job.status === 'running') return steps.find((s) => s.status === 'running');
  if (job.status === 'failed' || job.status === 'cancelled')
    return steps.find((s) => s.status === 'failed') ?? steps.find((s) => s.status === 'running');
  return undefined;
}

/** Start time of the current run; nothing for a job that is not running or has not run. */
export function Started({ job, labelled }: { job: Job; labelled?: boolean }) {
  if (!job.startedAt || job.status === 'pending') return null;
  return (
    <span>
      {labelled && 'started '}
      {formatClock(job.startedAt)}
    </span>
  );
}

export function Duration({
  job,
  now,
  p95,
  labelled,
}: {
  job: Job;
  now: number;
  p95: Record<string, number>;
  labelled?: boolean;
}) {
  const d = jobDuration(job, now);
  if (!d) return null;
  if (d.kind === 'waiting') return <span className="text-muted-foreground">waiting {formatDuration(d.ms)}</span>;
  if (d.kind === 'ready') return <span className="text-muted-foreground">ready in {formatDuration(d.ms)}</span>;
  const warn = d.kind === 'running' && elapsedTone(d.ms, p95[job.type]) === 'warn';
  return (
    <span className={cn('text-foreground', warn && 'font-semibold text-warn')}>
      {labelled && (
        <span className="font-normal text-muted-foreground">{d.kind === 'running' ? 'running ' : 'took '}</span>
      )}
      {formatDuration(d.ms)}
    </span>
  );
}

export function Attempts({ job }: { job: Job }) {
  const n = attemptsShown(job);
  return (
    <span className={cn(n > 1 || job.status === 'failed' ? 'text-foreground' : 'text-muted-foreground')}>
      {n}/{job.maxAttempt}
    </span>
  );
}

export function ErrorLine({ job, className }: { job: Pick<Job, 'status' | 'error'>; className?: string }) {
  if (job.status !== 'failed' || !job.error) return null;
  return (
    <div title={job.error} className={cn('truncate text-xs text-muted-foreground', className)}>
      {job.error}
    </div>
  );
}

/** Running: bar, percent and current step. Failed or cancelled: where it stopped. Otherwise nothing. */
export function Progress({ job, className }: { job: Job; className?: string }) {
  const pct = job.status === 'success' ? null : jobProgress(job);
  if (pct === null) return null;
  const step = currentStep(job);
  const running = job.status === 'running';
  const stepText = step && [step.id, step.message].filter(Boolean).join(': ');
  return (
    <span
      className={cn('flex min-w-0 items-center gap-2', className)}
      style={{ color: running ? typeColorVar(job.type) : 'var(--muted-foreground)' }}
    >
      <span aria-hidden className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-border">
        <span className="block h-full rounded-full bg-current" style={{ width: `${pct}%` }} />
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{pct}%</span>
      {stepText && (
        <span title={stepText} className="min-w-0 truncate text-xs text-muted-foreground">
          {running ? stepText : `at ${stepText}`}
        </span>
      )}
    </span>
  );
}

export function workerOf(job: Job, workers: Map<string, Worker>) {
  const id = job.workerId ?? job.lastWorkerId;
  if (!id) return null;
  const w = workers.get(id);
  return { name: w?.name ?? id, ip: w?.ip };
}

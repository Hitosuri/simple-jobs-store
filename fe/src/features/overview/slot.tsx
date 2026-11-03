import { PreviewCard } from '@base-ui/react/preview-card';
import { Link } from '@tanstack/react-router';
import { useJob } from '@/api/queries';
import type { RunningJob } from '@/api/types';
import { attemptsShown, TypeChip } from '@/features/jobs/job-cells';
import { formatClock, formatDuration } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';
import { elapsedTone } from './thresholds';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 tabular-nums">{children}</dd>
    </>
  );
}

function JobPreview({ job, worker, now }: { job: RunningJob; worker: string; now: number }) {
  const { data } = useJob(job.id);
  const step = data?.job.progress?.find((s) => s.status === 'running');
  return (
    <>
      <div className="mb-2 flex min-w-0 items-center gap-2 text-[13px] font-medium">
        <span className="tabular-nums">#{job.id}</span>
        <TypeChip type={job.type} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <Fact label="Worker">
          <span className="block truncate">{worker}</span>
        </Fact>
        <Fact label="Started">{formatClock(job.startedAt)}</Fact>
        <Fact label="Running for">{formatDuration(now - Date.parse(job.startedAt))}</Fact>
        {job.progressPercent !== null && <Fact label="Progress">{Math.round(job.progressPercent)}%</Fact>}
        {step && (
          <Fact label="Step">
            <span className="line-clamp-2 break-words">
              {step.id}
              {step.message && <span className="text-muted-foreground"> - {step.message}</span>}
            </span>
          </Fact>
        )}
        <Fact label="Attempt">{data ? `${attemptsShown(data.job)} of ${data.job.maxAttempt}` : '...'}</Fact>
      </dl>
    </>
  );
}

function SlotLink({
  job,
  worker,
  now,
  className,
  style,
  children,
  ...rest
}: {
  job: RunningJob;
  worker: string;
  now: number;
  className: string;
  style: React.CSSProperties;
  children?: React.ReactNode;
  'aria-label'?: string;
}) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={150}
        closeDelay={100}
        render={<Link to="/jobs/$jobId" params={{ jobId: String(job.id) }} />}
        className={className}
        style={style}
        {...rest}
      >
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50">
          <PreviewCard.Popup className="w-64 max-w-[calc(100vw-2rem)] rounded-lg bg-popover p-3 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
            <JobPreview job={job} worker={worker} now={now} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

export function Slot({ job, worker, now, p95 }: { job?: RunningJob; worker: string; now: number; p95?: number }) {
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
    <SlotLink
      job={job}
      worker={worker}
      now={now}
      style={{ color: typeColorVar(job.type) }}
      className="relative flex min-h-11 max-w-full min-w-[132px] items-center gap-1.5 rounded-md border border-border bg-inset px-2 pb-[3px] text-xs hover:border-ring md:h-[30px] md:min-h-0"
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
    </SlotLink>
  );
}

export function PlainDot({ job }: { job?: RunningJob }) {
  return (
    <span
      aria-hidden
      className={cn('block h-3.5 w-[9px] shrink-0 rounded-[3px]', !job && 'border border-dashed border-border')}
      style={job ? { background: typeColorVar(job.type) } : undefined}
    />
  );
}

export function SlotDot({ job, worker, now }: { job?: RunningJob; worker: string; now: number }) {
  const base = 'block h-3.5 w-[9px] shrink-0 rounded-[3px]';
  if (!job) return <span aria-hidden className={cn(base, 'border border-dashed border-border')} />;
  return (
    <SlotLink
      job={job}
      worker={worker}
      now={now}
      aria-label={`${job.type} job ${job.id}`}
      className={base}
      style={{ background: typeColorVar(job.type) }}
    />
  );
}

import { CircleCheck, CircleStop, CircleX, LoaderCircle, Minus, type LucideIcon } from 'lucide-react';
import type { JobStatus, ProgressStep } from '@/api/types';
import { shownStepStatus, type ShownStepStatus } from '@/features/jobs/job-cells';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const LOOK: Record<ShownStepStatus, { Icon: LucideIcon | null; tone: string }> = {
  pending: { Icon: null, tone: 'text-muted-foreground' },
  running: { Icon: LoaderCircle, tone: 'text-run' },
  stopped: { Icon: CircleStop, tone: 'text-muted-foreground' },
  done: { Icon: CircleCheck, tone: 'text-ok' },
  failed: { Icon: CircleX, tone: 'text-bad' },
  skipped: { Icon: Minus, tone: 'text-muted-foreground' },
};

function detail(s: ProgressStep, shown: ShownStepStatus): string {
  const counts = s.current !== null && s.total !== null ? `${formatNumber(s.current)} / ${formatNumber(s.total)}` : '';
  if (shown === 'stopped') return counts ? `stopped at ${counts}` : 'stopped';
  if (counts) return counts;
  if (shown === 'done') return 'done';
  return shown === 'pending' ? '' : shown;
}

export function ProgressCard({ steps, jobStatus }: { steps: ProgressStep[]; jobStatus: JobStatus }) {
  const lastAttempt = jobStatus === 'pending';
  return (
    <section className={cn('rounded-lg border bg-card px-3 py-2.5', lastAttempt && 'text-muted-foreground')}>
      <h3 className="mb-2 flex justify-between text-[13px] font-semibold">
        {lastAttempt ? 'Last attempt progress' : 'Progress'}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{steps.length} steps</span>
      </h3>
      <ul className="flex flex-col gap-2.5">
        {steps.map((s) => {
          const shown = shownStepStatus(s.status, jobStatus);
          const { Icon, tone } = LOOK[shown];
          return (
            <li
              key={s.id}
              className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-[13px]"
            >
              {Icon ? (
                <Icon aria-hidden className={cn('size-4', tone, shown === 'running' && 'motion-safe:animate-spin')} />
              ) : (
                <span aria-hidden className="size-3.5 rounded-full border border-dashed border-muted-foreground" />
              )}
              <span className={cn('break-all', shown === 'pending' && 'text-muted-foreground')}>{s.id}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{detail(s, shown)}</span>
              {s.percent !== null && shown !== 'done' && (
                <span className="col-span-2 col-start-2 h-1 overflow-hidden rounded-full bg-inset">
                  <span
                    className={cn(
                      'block h-full',
                      shown === 'failed' ? 'bg-bad' : shown === 'stopped' ? 'bg-muted-foreground' : 'bg-run',
                    )}
                    style={{ width: `${s.percent}%` }}
                  />
                </span>
              )}
              {s.message && (
                <span className="col-span-2 col-start-2 text-xs break-words text-muted-foreground">{s.message}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

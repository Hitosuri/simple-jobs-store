import { CircleCheck, CircleX, LoaderCircle, Minus, type LucideIcon } from 'lucide-react';
import type { ProgressStep, StepStatus } from '@/api/types';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const LOOK: Record<StepStatus, { Icon: LucideIcon | null; tone: string }> = {
  pending: { Icon: null, tone: 'text-muted-foreground' },
  running: { Icon: LoaderCircle, tone: 'text-run' },
  done: { Icon: CircleCheck, tone: 'text-ok' },
  failed: { Icon: CircleX, tone: 'text-bad' },
  skipped: { Icon: Minus, tone: 'text-muted-foreground' },
};

function detail(s: ProgressStep): string {
  if (s.current !== null && s.total !== null) return `${formatNumber(s.current)} / ${formatNumber(s.total)}`;
  if (s.status === 'done') return 'done';
  return s.status === 'pending' ? '' : s.status;
}

export function ProgressCard({ steps }: { steps: ProgressStep[] }) {
  return (
    <section className="rounded-lg border bg-card px-3 py-2.5">
      <h3 className="mb-2 flex justify-between text-[13px] font-semibold">
        Progress <span className="text-xs font-normal text-muted-foreground tabular-nums">{steps.length} steps</span>
      </h3>
      <ul className="flex flex-col gap-2.5">
        {steps.map((s) => {
          const { Icon, tone } = LOOK[s.status];
          return (
            <li
              key={s.id}
              className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-[13px]"
            >
              {Icon ? (
                <Icon
                  aria-hidden
                  className={cn('size-4', tone, s.status === 'running' && 'motion-safe:animate-spin')}
                />
              ) : (
                <span aria-hidden className="size-3.5 rounded-full border border-dashed border-muted-foreground" />
              )}
              <span className={cn('break-all', s.status === 'pending' && 'text-muted-foreground')}>{s.id}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{detail(s)}</span>
              {s.percent !== null && s.status !== 'done' && (
                <span className="col-span-2 col-start-2 h-1 overflow-hidden rounded-full bg-inset">
                  <span
                    className={cn('block h-full', s.status === 'failed' ? 'bg-bad' : 'bg-run')}
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

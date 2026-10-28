import { RotateCcw } from 'lucide-react';
import type { Attempt } from '@/api/types';
import { StatusBadge } from '@/components/status-badge';
import { formatDuration } from '@/lib/format';
import { formatDateTime, type TimelineItem } from './timeline';

function AttemptRow({ attempt, durationMs }: { attempt: Attempt; durationMs: number | null }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold tabular-nums">#{attempt.attemptNo}</span>
        <span className="min-w-0 break-all">{attempt.workerId}</span>
        <StatusBadge status={attempt.outcome ?? 'running'} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatDateTime(attempt.startedAt)}
        {durationMs !== null && ` · ${formatDuration(durationMs)}`}
      </p>
      {attempt.error && <p className="mt-0.5 text-xs break-words text-bad">{attempt.error}</p>}
    </>
  );
}

export function AttemptsTimeline({ items, count }: { items: TimelineItem[]; count: number }) {
  return (
    <section className="rounded-lg border bg-card px-3 py-2.5">
      <h3 className="mb-2 flex justify-between text-[13px] font-semibold">
        Attempts <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No attempts yet. A worker claims this job when it is pending.</p>
      ) : (
        <ol className="relative flex flex-col gap-3 pl-5 text-[13px] before:absolute before:top-1.5 before:bottom-1.5 before:left-[7px] before:w-0.5 before:bg-border">
          {items.map((item) =>
            item.kind === 'requeue' ? (
              <li
                key="requeue"
                className="relative flex items-center gap-1.5 text-xs text-muted-foreground before:absolute before:top-1.5 before:-left-[18px] before:size-3 before:rounded-full before:border-2 before:border-muted-foreground before:bg-card"
              >
                <RotateCcw aria-hidden className="size-3" />
                Requeued <span className="tabular-nums">{formatDateTime(item.at)}</span>
              </li>
            ) : (
              <li
                key={item.attempt.attemptNo}
                className="relative min-w-0 before:absolute before:top-1 before:-left-[18px] before:size-3 before:rounded-full before:border-2 before:border-muted-foreground before:bg-card"
              >
                <AttemptRow attempt={item.attempt} durationMs={item.durationMs} />
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  );
}

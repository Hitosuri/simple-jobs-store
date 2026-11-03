import { useLayoutEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import type { Worker } from '@/api/types';
import { formatAgo } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';
import { workerLabels } from '@/lib/worker-label';
import { barTitle, type LaneBar } from './lanes';

const clock = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const TICKS = [0, 0.25, 0.5, 0.75, 1];
const ROW = 'grid grid-cols-[180px_1fr] md:grid-cols-[248px_1fr]';
const GRID = 'bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-[length:25%_100%]';

function Bar({ bar }: { bar: LaneBar }) {
  const title = barTitle(bar);
  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: String(bar.jobId) }}
      aria-label={title.replaceAll('\n', ', ')}
      title={title}
      style={{
        left: `${bar.leftPct}%`,
        width: `${bar.widthPct}%`,
        backgroundColor: typeColorVar(bar.type),
        backgroundImage: bar.failed
          ? 'repeating-linear-gradient(135deg, transparent 0 3px, rgb(0 0 0 / 0.4) 3px 5px)'
          : undefined,
      }}
      className={cn(
        'absolute inset-y-0.5 min-w-[3px] rounded-[2px] hover:brightness-110',
        bar.failed && 'inset-ring-2 inset-ring-bad',
      )}
    />
  );
}

function WorkerLabel({ worker, label, busy, now }: { worker: Worker; label: string; busy: number; now: number }) {
  const state = worker.connected ? `${busy}/${worker.concurrentLimit}` : formatAgo(worker.lastSeenAt, now);
  const dot = !worker.connected ? 'bg-bad' : busy > 0 ? 'bg-ok' : 'bg-muted-foreground';
  const suffix = label === worker.name ? null : label.slice(worker.name.length + 3);
  return (
    <Link
      from="/machines"
      to="/machines/$workerId"
      params={{ workerId: worker.id }}
      search={(prev) => prev}
      title={worker.connected ? `${label} - ${state} slots busy` : `${label} - last seen ${state}`}
      className="sticky left-0 z-10 flex min-h-11 items-center gap-2 bg-card pr-3 text-[13px] hover:bg-inset md:min-h-9"
    >
      <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', dot)} />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate">{worker.name}</span>
        {suffix && <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{state}</span>
      <span className="sr-only">{worker.connected ? 'slots busy, online' : 'last seen, offline'}</span>
    </Link>
  );
}

export function Swimlane({
  groups,
  lanes,
  busy,
  from,
  to,
  now,
}: {
  groups: { ip: string; workers: Worker[] }[];
  lanes: Map<string, LaneBar[]>;
  busy: Map<string, number>;
  from: number;
  to: number;
  now: number;
}) {
  const types = [...new Set([...lanes.values()].flatMap((bars) => bars.map((b) => b.type)))].sort();
  const scroller = useRef<HTMLDivElement>(null);
  const span = to - from;
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [span]);

  return (
    <div className="flex flex-col gap-2">
      <div ref={scroller} className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className={ROW}>
            <span className="sticky left-0 z-10 bg-card" />
            <div className="flex justify-between pb-1 text-xs text-muted-foreground tabular-nums">
              {TICKS.map((t) => (
                <span key={t}>{clock.format(from + span * t)}</span>
              ))}
            </div>
          </div>
          {groups.map(({ ip, workers }) => {
            const live = workers.filter((w) => w.connected);
            const total = live.reduce((n, w) => n + w.concurrentLimit, 0);
            const used = live.reduce((n, w) => n + (busy.get(w.id) ?? 0), 0);
            const labels = workerLabels(workers);
            return (
              <div key={ip} className="pb-1">
                <div className={cn(ROW, 'border-t border-border')}>
                  <div className="sticky left-0 z-10 flex items-baseline justify-between gap-2 bg-card pt-3 pr-3 pb-1.5 text-xs tabular-nums">
                    <span className="truncate font-semibold text-foreground">{ip}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {live.length > 0 ? `${used}/${total} slots busy` : 'offline'}
                    </span>
                  </div>
                  <div className={GRID} />
                </div>
                {workers.map((w) => (
                  <div key={w.id} className={cn(ROW, !w.connected && 'text-muted-foreground')}>
                    <WorkerLabel worker={w} label={labels.get(w.id)!} busy={busy.get(w.id) ?? 0} now={now} />
                    <div className={cn('flex items-center', GRID)}>
                      <div className="relative h-6 w-full overflow-hidden">
                        {lanes.get(w.id)?.map((bar) => (
                          <Bar key={`${bar.jobId}-${bar.attemptNo}`} bar={bar} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {types.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {types.map((t) => (
            <li key={t} className="flex max-w-48 items-center gap-1.5 truncate">
              <span aria-hidden className="size-2.5 rounded-[2px]" style={{ backgroundColor: typeColorVar(t) }} />
              {t}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-[2px] bg-muted-foreground inset-ring-2 inset-ring-bad"
              style={{
                backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 3px, rgb(0 0 0 / 0.4) 3px 5px)',
              }}
            />
            not succeeded
          </li>
        </ul>
      )}
    </div>
  );
}

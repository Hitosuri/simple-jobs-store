import { Link } from '@tanstack/react-router';
import type { Worker } from '@/api/types';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';
import type { LaneBar } from './lanes';

const clock = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const TICKS = [0, 0.25, 0.5, 0.75, 1];
const ROW = 'grid grid-cols-[160px_1fr] md:grid-cols-[200px_1fr]';

function Bar({ bar }: { bar: LaneBar }) {
  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: String(bar.jobId) }}
      aria-label={`Job #${bar.jobId} ${bar.type}${bar.failed ? ' (not succeeded)' : ''}`}
      title={`#${bar.jobId} ${bar.type}`}
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
        bar.failed && 'ring-2 ring-bad ring-inset',
      )}
    />
  );
}

export function Swimlane({
  workers,
  lanes,
  from,
  to,
}: {
  workers: Worker[];
  lanes: Map<string, LaneBar[]>;
  from: number;
  to: number;
}) {
  const types = [...new Set([...lanes.values()].flatMap((bars) => bars.map((b) => b.type)))].sort();
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className={ROW}>
            <span className="sticky left-0 z-10 bg-card" />
            <div className="flex justify-between pb-1 text-xs text-muted-foreground tabular-nums">
              {TICKS.map((t) => (
                <span key={t}>{clock.format(from + (to - from) * t)}</span>
              ))}
            </div>
          </div>
          {workers.map((w) => (
            <div key={w.id} className={cn(ROW, 'border-t border-border', !w.connected && 'opacity-60')}>
              <Link
                from="/machines"
                to="/machines/$workerId"
                params={{ workerId: w.id }}
                search={(prev) => prev}
                className="sticky left-0 z-10 flex min-h-6 items-center gap-1.5 bg-card pr-2 text-[13px]"
              >
                <span
                  aria-hidden
                  className={cn('size-[7px] shrink-0 rounded-full', w.connected ? 'bg-ok' : 'bg-bad')}
                />
                <span className="truncate">{w.name}</span>
                <span className="sr-only">{w.connected ? 'online' : 'offline'}</span>
              </Link>
              <div className="relative h-6 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-[length:25%_100%]">
                {lanes.get(w.id)?.map((bar) => (
                  <Bar key={`${bar.jobId}-${bar.attemptNo}`} bar={bar} />
                ))}
              </div>
            </div>
          ))}
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
              className="size-2.5 rounded-[2px] bg-muted-foreground ring-2 ring-bad ring-inset"
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

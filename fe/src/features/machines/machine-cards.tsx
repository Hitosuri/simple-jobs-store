import { Link } from '@tanstack/react-router';
import type { Worker, WorkerLoad } from '@/api/types';
import { Card } from '@/components/ui/card';
import { formatAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { groupByMachine } from './lanes';

function WorkerLine({ worker, busy, now }: { worker: Worker; busy: number; now: number }) {
  const dot = !worker.connected ? 'bg-bad' : busy > 0 ? 'bg-ok' : 'bg-muted-foreground';
  return (
    <Link
      from="/machines"
      to="/machines/$workerId"
      params={{ workerId: worker.id }}
      search={(prev) => prev}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-md px-1 text-[13px] hover:bg-inset md:min-h-8',
        !worker.connected && 'opacity-60',
      )}
    >
      <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', dot)} />
      <span className="min-w-0 flex-1 truncate">{worker.name}</span>
      {worker.connected ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {busy}/{worker.concurrentLimit} slots
        </span>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          last seen {formatAgo(worker.lastSeenAt, now)}
        </span>
      )}
    </Link>
  );
}

export function MachineCards({ workers, loads, now }: { workers: Worker[]; loads: WorkerLoad[]; now: number }) {
  const busyOf = new Map(loads.map((l) => [l.worker.id, l.running.length]));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {groupByMachine(workers).map(({ ip, workers: ws }) => {
        const live = ws.filter((w) => w.connected);
        const total = live.reduce((n, w) => n + w.concurrentLimit, 0);
        const busy = live.reduce((n, w) => n + (busyOf.get(w.id) ?? 0), 0);
        return (
          <Card key={ip} className="gap-1 px-3 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold">{ip}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                {ws.length} {ws.length === 1 ? 'worker' : 'workers'} · {busy}/{total} slots
              </span>
            </div>
            {ws.map((w) => (
              <WorkerLine key={w.id} worker={w} busy={busyOf.get(w.id) ?? 0} now={now} />
            ))}
          </Card>
        );
      })}
    </div>
  );
}

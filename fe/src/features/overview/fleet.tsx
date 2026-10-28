import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { WorkerLoad } from '@/api/types';
import { Card } from '@/components/ui/card';
import { formatAgo, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Slot, SlotDot } from './slot';

const DOT_STRIP_ABOVE = 8;

function slotsOf({ worker, running }: WorkerLoad) {
  const idle = Math.max(worker.concurrentLimit - running.length, 0);
  return { running, idle };
}

function WorkerRow({ load, now, p95 }: { load: WorkerLoad; now: number; p95: Record<string, number> }) {
  const { worker } = load;
  const { running, idle } = slotsOf(load);
  const dotClass = !worker.connected ? 'bg-bad' : running.length ? 'bg-ok' : 'bg-muted-foreground';
  return (
    <div className={cn('my-1.5 flex items-start gap-2.5 md:items-center', !worker.connected && 'opacity-60')}>
      <Link
        to="/machines/$workerId"
        params={{ workerId: worker.id }}
        className="flex min-h-11 w-24 shrink-0 items-center gap-1.5 text-[13px] md:min-h-0"
      >
        <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', dotClass)} />
        <span className="truncate">{worker.name}</span>
      </Link>
      {!worker.connected ? (
        <span className="self-center text-xs text-muted-foreground">
          last seen {formatAgo(worker.lastSeenAt, now)} · lease expired
        </span>
      ) : worker.concurrentLimit > DOT_STRIP_ABOVE ? (
        <span className="flex flex-1 flex-wrap items-center gap-[3px] self-center">
          {running.map((job) => (
            <SlotDot key={job.id} job={job} now={now} />
          ))}
          {Array.from({ length: idle }, (_, i) => (
            <SlotDot key={`idle-${i}`} />
          ))}
          <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
            {running.length}/{worker.concurrentLimit}
          </span>
        </span>
      ) : (
        <span className="flex flex-1 flex-wrap gap-1.5">
          {running.map((job) => (
            <Slot key={job.id} job={job} now={now} p95={p95[job.type]} />
          ))}
          {Array.from({ length: idle }, (_, i) => (
            <Slot key={`idle-${i}`} now={now} />
          ))}
        </span>
      )}
    </div>
  );
}

function Machine({
  ip,
  loads,
  now,
  p95,
}: {
  ip: string;
  loads: WorkerLoad[];
  now: number;
  p95: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const live = loads.filter((l) => l.worker.connected);
  const lost = loads.length - live.length;
  const total = live.reduce((n, l) => n + l.worker.concurrentLimit, 0);
  const busy = live.reduce((n, l) => n + l.running.length, 0);
  return (
    <div className="mt-2.5 border-t border-border pt-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full flex-wrap items-center gap-x-1.5 gap-y-1 text-left text-xs text-muted-foreground md:pointer-events-none md:min-h-0"
      >
        <b className="mr-1 text-[13px] font-semibold text-foreground">{ip}</b>
        <span className="tabular-nums">
          {loads.length} {loads.length === 1 ? 'worker' : 'workers'}
          {busy === 0 && !lost ? ' · idle' : ` · ${busy}/${total} slots`}
        </span>
        {lost > 0 && <span className="text-bad">· {lost} lost</span>}
        <span className="flex basis-full flex-wrap gap-[3px] pb-1.5 md:hidden">
          {live.flatMap((l) => {
            const { running, idle } = slotsOf(l);
            return [
              ...running.map((job) => <SlotDot key={job.id} job={job} now={now} />),
              ...Array.from({ length: idle }, (_, i) => <SlotDot key={`${l.worker.id}-${i}`} />),
            ];
          })}
        </span>
      </button>
      <div className={cn(!open && 'max-md:hidden')}>
        {loads.map((load) => (
          <WorkerRow key={load.worker.id} load={load} now={now} p95={p95} />
        ))}
      </div>
    </div>
  );
}

export function Fleet({
  workers,
  pending,
  p95,
  now,
}: {
  workers: WorkerLoad[];
  pending: number;
  p95: Record<string, number>;
  now: number;
}) {
  const live = workers.filter((l) => l.worker.connected);
  const total = live.reduce((n, l) => n + l.worker.concurrentLimit, 0);
  const busy = live.reduce((n, l) => n + l.running.length, 0);
  const ratio = total ? Math.min(busy / total, 1) : 0;
  const machines = new Map<string, WorkerLoad[]>();
  for (const l of workers) machines.set(l.worker.ip, [...(machines.get(l.worker.ip) ?? []), l]);

  return (
    <Card className="gap-0 bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_60%)] px-4">
      <div className="mb-1.5 flex justify-between text-xs font-medium text-muted-foreground">
        <span>Fleet</span>
        <span className="tabular-nums">
          {machines.size} {machines.size === 1 ? 'machine' : 'machines'} · {workers.length}{' '}
          {workers.length === 1 ? 'worker' : 'workers'}
        </span>
      </div>
      <div className="text-[34px] leading-[1.05] font-semibold tracking-tight tabular-nums">
        {busy}
        <span className="text-xl font-medium text-muted-foreground"> / {total} slots busy</span>
      </div>
      <div
        role="meter"
        aria-label="Busy slots"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={busy}
        className="mt-2.5 mb-1 h-1.5 overflow-hidden rounded-full bg-inset"
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary),color-mix(in_srgb,var(--primary)_55%,white))]"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {Math.round(ratio * 100)}% capacity · {formatNumber(pending)} jobs waiting
      </div>
      <div className="mt-1 max-h-[420px] overflow-y-auto">
        {workers.length === 0 ? (
          <p className="mt-2.5 border-t border-border pt-2.5 text-sm text-muted-foreground">
            No workers registered. Start a worker to see slots here.
          </p>
        ) : (
          [...machines].map(([ip, loads]) => <Machine key={ip} ip={ip} loads={loads} now={now} p95={p95} />)
        )}
      </div>
    </Card>
  );
}

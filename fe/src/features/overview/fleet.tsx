import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import type { Alert, WorkerLoad } from '@/api/types';
import { groupByMachine } from '@/features/machines/lanes';
import { Card } from '@/components/ui/card';
import { formatAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { workerLabels } from '@/lib/worker-label';
import { PlainDot, Slot, SlotDot } from './slot';
import { fleetVerdict } from './summary';
import { toneClass } from './thresholds';

const DOT_STRIP_ABOVE = 8;

function slotsOf({ worker, running }: WorkerLoad) {
  const idle = Math.max(worker.concurrentLimit - running.length, 0);
  return { running, idle };
}

function WorkerRow({
  load,
  label,
  now,
  p95,
}: {
  load: WorkerLoad;
  label: string;
  now: number;
  p95: Record<string, number>;
}) {
  const { worker } = load;
  const { running, idle } = slotsOf(load);
  const dotClass = !worker.connected ? 'bg-bad' : running.length ? 'bg-ok' : 'bg-muted-foreground';
  const suffix = label === worker.name ? null : label.slice(worker.name.length + ' · '.length);
  return (
    <div className="my-1.5 flex items-start gap-2.5 md:items-center">
      <Link
        to="/machines/$workerId"
        params={{ workerId: worker.id }}
        title={label}
        className={cn(
          'flex min-h-11 w-32 shrink-0 items-center gap-1.5 text-[13px] md:min-h-0 md:w-44',
          !worker.connected && 'text-muted-foreground',
        )}
      >
        <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', dotClass)} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate">{worker.name}</span>
          {suffix && <span className="block truncate text-xs text-muted-foreground">{suffix}</span>}
        </span>
      </Link>
      {!worker.connected ? (
        <span className="self-center text-xs text-muted-foreground">
          stopped responding {formatAgo(worker.lastSeenAt, now)}
        </span>
      ) : worker.concurrentLimit > DOT_STRIP_ABOVE ? (
        <span className="flex flex-1 flex-wrap items-center gap-[3px] self-center">
          {running.map((job) => (
            <SlotDot key={job.id} job={job} worker={label} now={now} />
          ))}
          {Array.from({ length: idle }, (_, i) => (
            <SlotDot key={`idle-${i}`} worker={label} now={now} />
          ))}
          <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
            {running.length}/{worker.concurrentLimit}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {running.map((job) => (
            <Slot key={job.id} job={job} worker={label} now={now} p95={p95[job.type]} />
          ))}
          {Array.from({ length: idle }, (_, i) => (
            <Slot key={`idle-${i}`} worker={label} now={now} />
          ))}
        </span>
      )}
    </div>
  );
}

function Machine({
  ip,
  loads,
  only,
  now,
  p95,
}: {
  ip: string;
  loads: WorkerLoad[];
  only: boolean;
  now: number;
  p95: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const labels = workerLabels(loads.map((l) => l.worker));
  const live = loads.filter((l) => l.worker.connected);
  const lost = loads.length - live.length;
  const total = live.reduce((n, l) => n + l.worker.concurrentLimit, 0);
  const busy = live.reduce((n, l) => n + l.running.length, 0);
  const summary = (
    <>
      <b className="mr-1 text-[13px] font-semibold text-foreground">{ip}</b>
      <span className="tabular-nums">
        {loads.length} {loads.length === 1 ? 'worker' : 'workers'}
        {!only && (busy === 0 && !lost ? ' · idle' : ` · ${busy}/${total} slots`)}
      </span>
      {lost > 0 && <span className="text-bad">· {lost} not responding</span>}
    </>
  );
  return (
    <div className="mt-2.5 border-t border-border pt-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full flex-wrap items-center gap-x-1.5 gap-y-1 text-left text-xs text-muted-foreground md:hidden"
      >
        {summary}
        <ChevronDown aria-hidden className={cn('ml-auto size-4 text-foreground', open && 'rotate-180')} />
        <span className="flex basis-full flex-wrap gap-[3px] pb-1.5">
          {live.flatMap((l) => {
            const { running, idle } = slotsOf(l);
            return [
              ...running.map((job) => <PlainDot key={job.id} job={job} />),
              ...Array.from({ length: idle }, (_, i) => <PlainDot key={`${l.worker.id}-${i}`} />),
            ];
          })}
        </span>
        <span className="sr-only">
          {busy} of {total} slots busy
        </span>
      </button>
      <div className="hidden flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground md:flex">{summary}</div>
      <div className={cn(!open && 'max-md:hidden')}>
        {loads.map((load) => (
          <WorkerRow key={load.worker.id} load={load} label={labels.get(load.worker.id)!} now={now} p95={p95} />
        ))}
      </div>
    </div>
  );
}

export function Fleet({
  workers,
  alerts,
  failed,
  oldestWaitMs,
  p95,
  now,
}: {
  workers: WorkerLoad[];
  alerts: Alert[];
  failed: number;
  oldestWaitMs: number | null;
  p95: Record<string, number>;
  now: number;
}) {
  const live = workers.filter((l) => l.worker.connected);
  const total = live.reduce((n, l) => n + l.worker.concurrentLimit, 0);
  const busy = live.reduce((n, l) => n + l.running.length, 0);
  const ratio = total ? Math.min(busy / total, 1) : 0;
  const loadOf = new Map(workers.map((l) => [l.worker.id, l]));
  const machines = groupByMachine(workers.map((l) => l.worker)).map(({ ip, workers: ws }) => ({
    ip,
    loads: ws.map((w) => loadOf.get(w.id)!),
  }));
  const labels = workerLabels(workers.map((l) => l.worker));
  const lostWorkers = alerts.filter((a) => a.kind === 'worker_lost').map((a) => labels.get(a.workerId) ?? a.workerId);
  const verdict = fleetVerdict({ lostWorkers, failed, busy, total, oldestWaitMs });

  return (
    <Card className="gap-0 bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_60%)] px-4">
      <div className="mb-1.5 flex justify-between text-xs font-medium text-muted-foreground">
        <span>Fleet</span>
        {machines.length > 1 && (
          <span className="tabular-nums">
            {machines.length} machines · {workers.length} workers
          </span>
        )}
      </div>
      <div
        className={cn(
          'text-[28px] leading-[1.05] md:text-[34px] font-semibold tracking-tight text-balance tabular-nums',
          toneClass[verdict.tone],
        )}
      >
        {verdict.text}
        {verdict.detail && <span className="text-xl font-medium text-muted-foreground"> - {verdict.detail}</span>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
          {busy > total ? (
            <>
              <b className="font-semibold text-foreground">{busy}</b> running on {total} slots
            </>
          ) : (
            <>
              <b className="font-semibold text-foreground">{busy}</b> / {total} slots busy
            </>
          )}
        </span>
        <div
          role="meter"
          aria-label="Busy slots"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(busy, total)}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset"
        >
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary),color-mix(in_srgb,var(--primary)_55%,white))]"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>
      <div className="mt-1 max-h-[420px] overflow-y-auto">
        {workers.length === 0 ? (
          <p className="mt-2.5 border-t border-border pt-2.5 text-sm text-muted-foreground">
            No workers registered. Start a worker to see slots here.
          </p>
        ) : (
          machines.map(({ ip, loads }) => (
            <Machine key={ip} ip={ip} loads={loads} only={machines.length === 1} now={now} p95={p95} />
          ))
        )}
      </div>
    </Card>
  );
}

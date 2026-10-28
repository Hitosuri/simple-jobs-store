import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Trash2, X } from 'lucide-react';
import { useAttempts, useOverview, useWorkers } from '@/api/queries';
import { useForgetWorker } from '@/api/mutations';
import type { AttemptRow, Worker } from '@/api/types';
import { BlockError } from '@/components/block-error';
import { StatusBadge } from '@/components/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime } from '@/features/job-detail/timeline';
import { rateTone, toneClass, type Tone } from '@/features/overview/thresholds';
import { formatAgo, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { useNow } from '@/lib/use-now';
import { summarizeAttempts } from './lanes';
import { useAttemptWindow } from './use-window';

const DAY_MS = 86_400_000;
const RECENT = 10;

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card px-3 py-2.5">
      <h3 className="mb-2 flex justify-between text-[13px] font-semibold">
        {title}
        {aside && <span className="text-xs font-normal text-muted-foreground tabular-nums">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value, tone = 'fg' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${toneClass[tone]}`}>{value}</div>
    </div>
  );
}

function Forget({ worker, onForgotten }: { worker: Worker; onForgotten: () => void }) {
  const forget = useForgetWorker();
  const [open, setOpen] = useState(false);
  const button = (
    <Button
      variant="destructive"
      disabled={worker.connected || forget.isPending}
      onClick={() => setOpen(true)}
      className="w-full max-md:h-11"
    >
      <Trash2 />
      Forget worker
    </Button>
  );
  return (
    <>
      {worker.connected ? (
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="flex" />}>{button}</TooltipTrigger>
          <TooltipContent>Only offline workers can be forgotten</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget {worker.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The worker is removed from the list. It reappears if it connects again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => forget.mutateAsync(worker.id).then(onForgotten, () => {})}
            >
              Forget worker
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RecentAttempts({ rows, now }: { rows: AttemptRow[]; now: number }) {
  const recent = useMemo(
    () => [...rows].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, RECENT),
    [rows],
  );
  if (recent.length === 0) return <p className="text-xs text-muted-foreground">No attempts in the last 24 h.</p>;
  return (
    <ul className="flex flex-col gap-2.5 text-[13px]">
      {recent.map((a) => {
        const end = a.endedAt ? Date.parse(a.endedAt) : a.outcome === null ? now : null;
        return (
          <li key={`${a.jobId}-${a.attemptNo}`} className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                to="/jobs/$jobId"
                params={{ jobId: String(a.jobId) }}
                className="font-semibold tabular-nums hover:underline max-md:py-3"
              >
                #{a.jobId}
              </Link>
              <span className="min-w-0 break-all" style={{ color: typeColorVar(a.jobType) }}>
                {a.jobType}
              </span>
              <StatusBadge status={a.outcome ?? 'running'} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatDateTime(a.startedAt)}
              {end !== null && ` · ${formatDuration(end - Date.parse(a.startedAt))}`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function Loaded({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const now = useNow();
  const win = useAttemptWindow(DAY_MS);
  const attempts = useAttempts(win.fromIso, win.toIso, worker.id);
  const overview = useOverview();
  const running = overview.data?.workers.find((l) => l.worker.id === worker.id)?.running ?? [];
  const rows = useMemo(() => attempts.data ?? [], [attempts.data]);
  const stats = useMemo(() => summarizeAttempts(rows), [rows]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-4">
        <Section title={worker.name} aside={worker.connected ? 'connected' : 'offline'}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Machine</dt>
            <dd className="tabular-nums">{worker.ip}</dd>
            <dt className="text-muted-foreground">Heartbeat</dt>
            <dd className="tabular-nums">{formatAgo(worker.lastSeenAt, now)}</dd>
            <dt className="text-muted-foreground">Lease</dt>
            <dd className={worker.connected ? 'tabular-nums' : 'text-bad tabular-nums'}>
              {worker.connected
                ? `expires in ${formatDuration(worker.leaseMsRemaining)}`
                : `expired ${formatAgo(worker.leaseUntil, now)}`}
            </dd>
            <dt className="text-muted-foreground">Slots</dt>
            <dd className="tabular-nums">
              {running.length}/{worker.concurrentLimit} busy
            </dd>
            <dt className="text-muted-foreground">Id</dt>
            <dd className="break-all">{worker.id}</dd>
          </dl>
        </Section>

        <Section title="Last 24 h">
          {attempts.data ? (
            <div className="flex gap-3">
              <Stat label="Done" value={formatNumber(stats.done)} />
              <Stat label="Success rate" value={formatPercent(stats.successRate)} tone={rateTone(stats.successRate)} />
              <Stat label="Mean run" value={stats.meanRunMs === null ? '\u{2014}' : formatDuration(stats.meanRunMs)} />
            </div>
          ) : attempts.isError ? (
            <BlockError
              message={attempts.error.message}
              lastGoodAt={attempts.dataUpdatedAt}
              onRetry={() => attempts.refetch()}
            />
          ) : (
            <div className="h-14 rounded-md bg-inset" />
          )}
        </Section>

        <Section title="Running jobs" aside={String(running.length)}>
          {running.length === 0 ? (
            <p className="text-xs text-muted-foreground">Idle. No jobs running on this worker.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px]">
              {running.map((job) => (
                <li key={job.id}>
                  <Link
                    to="/jobs/$jobId"
                    params={{ jobId: String(job.id) }}
                    className="flex min-h-11 items-center gap-2 md:min-h-7"
                  >
                    <span className="font-semibold tabular-nums">#{job.id}</span>
                    <span className="min-w-0 truncate" style={{ color: typeColorVar(job.type) }}>
                      {job.type}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {formatDuration(now - Date.parse(job.startedAt))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Recent attempts"
          aside={attempts.data ? `${Math.min(rows.length, RECENT)} of ${rows.length}` : undefined}
        >
          {attempts.data ? <RecentAttempts rows={rows} now={now} /> : <div className="h-24 rounded-md bg-inset" />}
        </Section>

        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/jobs" search={{ worker: worker.id }} />}
          className="max-md:h-11"
        >
          All jobs of this worker
        </Button>
      </div>
      <div className="border-t bg-popover p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Forget worker={worker} onForgotten={onClose} />
      </div>
    </>
  );
}

function Body({ workerId, onClose }: { workerId: string; onClose: () => void }) {
  const workers = useWorkers(true);
  const worker = workers.data?.find((w) => w.id === workerId);
  if (worker) return <Loaded worker={worker} onClose={onClose} />;
  if (workers.isError) {
    return (
      <div className="p-4">
        <BlockError
          message={workers.error.message}
          lastGoodAt={workers.dataUpdatedAt}
          onRetry={() => workers.refetch()}
        />
      </div>
    );
  }
  if (workers.data) {
    return (
      <div className="flex flex-col items-start gap-3 p-4 text-sm">
        <p className="text-base font-semibold">Worker not found</p>
        <p className="text-muted-foreground">Worker {workerId} is not registered. It may have been forgotten.</p>
        <Button variant="outline" onClick={onClose} className="max-md:min-h-11">
          Close
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-3">
      <div className="h-32 rounded-lg bg-inset" />
      <div className="h-20 rounded-lg bg-inset" />
      <div className="h-32 rounded-lg bg-inset" />
    </div>
  );
}

export function WorkerDrawer({ workerId, onClose }: { workerId: string; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        showCloseButton={false}
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:lg:w-[420px]"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <SheetTitle>Worker</SheetTitle>
          <SheetDescription className="sr-only">Worker details and actions</SheetDescription>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="max-md:size-11">
            <X />
          </Button>
        </div>
        <Body workerId={workerId} onClose={onClose} />
      </SheetContent>
    </Sheet>
  );
}

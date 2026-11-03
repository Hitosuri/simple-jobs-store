import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
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
import { api } from '@/api/client';
import { useBulk } from '@/api/mutations';
import type { BulkResult, Finished, Job, Page, TypeQueue } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { bulkResultMessage } from '@/features/jobs/bulk-result';
import { formatDelta } from '@/features/stats/delta';
import { TypeChip } from '@/features/jobs/job-cells';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { oldestWait, roughDuration, SMALL_SAMPLE, successShown, waitOf } from './summary';
import { failedTone, pendingTone, rateTone, toneClass, type Tone } from './thresholds';

const CHUNK = 1000;

const rateOf = ({ success, failed }: Finished) => (success + failed ? success / (success + failed) : null);

function QueueRows({ queues, now }: { queues: TypeQueue[]; now: number }) {
  if (queues.length === 0) return <p className="mt-0.5">Nothing waiting.</p>;
  const sorted = [...queues].sort((a, b) => b.pending - a.pending || a.type.localeCompare(b.type));
  return (
    <ul className="mt-1.5">
      {sorted.map((q) => {
        const wait = waitOf(q, now);
        return (
          <li key={q.type}>
            <Link
              to="/jobs"
              search={{ status: ['pending'], type: [q.type] }}
              aria-label={`${q.type}: ${formatNumber(q.pending)} waiting, oldest ${roughDuration(wait)}, show jobs`}
              className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 hover:bg-inset max-md:min-h-11"
            >
              <span className="flex min-w-0 flex-1">
                <TypeChip type={q.type} />
              </span>
              <span className="text-foreground tabular-nums">{formatNumber(q.pending)}</span>
              <span
                className={cn(
                  'w-[4.5rem] shrink-0 text-right tabular-nums',
                  pendingTone(wait) === 'warn' && 'font-semibold text-warn',
                )}
              >
                oldest {roughDuration(wait)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Kpi({
  label,
  value,
  tone,
  className,
  children,
}: {
  label: string;
  value: React.ReactNode;
  tone: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('min-w-0 px-4 py-3', className)}>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn('text-2xl font-semibold tracking-tight tabular-nums', toneClass[tone])}>{value}</div>
      <div className="text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function RetryAll({ failed }: { failed: number }) {
  const bulk = useBulk();
  const [open, setOpen] = useState(false);

  async function run() {
    const ids: number[] = [];
    for (let page = 1; ids.length < failed; page++) {
      const res = await api<Page<Job>>(`/jobs?status=failed&pageSize=${CHUNK}&page=${page}`);
      ids.push(...res.items.map((j) => j.id));
      if (res.items.length < CHUNK) break;
    }
    const result: BulkResult = { done: [], skipped: [] };
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await bulk.mutateAsync({ action: 'retry', ids: ids.slice(i, i + CHUNK) });
      result.done.push(...res.done);
      result.skipped.push(...res.skipped);
    }
    toast(bulkResultMessage('retry', result));
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={bulk.isPending}
        onClick={() => setOpen(true)}
        className="mt-1 max-md:min-h-11"
      >
        <RotateCcw />
        Retry {formatNumber(failed)}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry {formatNumber(failed)} failed jobs?</AlertDialogTitle>
            <AlertDialogDescription>
              Every job currently failed is requeued with a fresh attempt budget, whatever its age.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run().catch((e: Error) => toast.error(e.message))}>
              Retry {formatNumber(failed)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function KpiCard({
  pending,
  failedNow,
  queues,
  finished,
  previous,
  now,
}: {
  pending: number;
  failedNow: number;
  queues: TypeQueue[];
  finished: Finished;
  previous: Finished;
  now: number;
}) {
  const total = finished.success + finished.failed;
  const shown = successShown(finished);
  const delta = formatDelta(rateOf(finished), rateOf(previous), 'rate', '24h');

  return (
    <Card className="gap-0 py-0">
      <div className="grid flex-1 grid-cols-2 lg:grid-cols-1 lg:grid-rows-[auto_auto_1fr]">
        <Kpi
          label="Queue"
          value={
            <>
              {formatNumber(pending)}
              <span className="ml-1.5 text-[13px] font-normal tracking-normal text-muted-foreground">waiting</span>
            </>
          }
          tone={pendingTone(oldestWait(queues, now))}
          className="col-span-2 border-b border-border lg:col-span-1"
        >
          <QueueRows queues={queues} now={now} />
        </Kpi>
        <Kpi
          label="Success · 24h"
          value={shown.text}
          tone={rateTone(shown.rate)}
          className="border-r border-border lg:border-r-0 lg:border-b"
        >
          {total === 0
            ? 'none finished'
            : total < SMALL_SAMPLE
              ? 'succeeded'
              : (delta ?? `${formatNumber(total)} jobs`)}
        </Kpi>
        <Kpi
          label="Failed · 24h"
          value={
            failedNow > 0 ? (
              <Link
                to="/jobs"
                search={{ status: ['failed'] }}
                aria-label={`${formatNumber(finished.failed)} failed in 24h, show failed jobs`}
                className="underline-offset-4 hover:underline"
              >
                {formatNumber(finished.failed)}
              </Link>
            ) : (
              formatNumber(finished.failed)
            )
          }
          tone={failedTone(finished.failed)}
        >
          {failedNow > 0 ? <RetryAll failed={failedNow} /> : finished.failed > 0 ? 'none still failed' : 'none in 24h'}
        </Kpi>
      </div>
    </Card>
  );
}

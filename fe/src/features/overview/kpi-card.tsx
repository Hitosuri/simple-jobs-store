import { toast } from 'sonner';
import { api } from '@/api/client';
import { useBulk } from '@/api/mutations';
import type { Finished, Job, Page, TypeQueue } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { failedTone, pendingTone, rateTone, toneClass, type Tone } from './thresholds';

const CHUNK = 1000;

const rateOf = ({ success, failed }: Finished) => (success + failed ? success / (success + failed) : null);

function Kpi({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn('text-2xl font-semibold tracking-tight tabular-nums', toneClass[tone])}>{value}</div>
      <div className="text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function RetryAll({ failed }: { failed: number }) {
  const bulk = useBulk();

  async function run() {
    const ids: number[] = [];
    for (let page = 1; ids.length < failed; page++) {
      const res = await api<Page<Job>>(`/jobs?status=failed&pageSize=${CHUNK}&page=${page}`);
      ids.push(...res.items.map((j) => j.id));
      if (res.items.length < CHUNK) break;
    }
    let done = 0;
    let skipped = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await bulk.mutateAsync({ action: 'retry', ids: ids.slice(i, i + CHUNK) });
      done += res.done.length;
      skipped += res.skipped.length;
    }
    toast(`Retried ${done}${skipped ? `, skipped ${skipped}` : ''}`);
  }

  return (
    <Button
      variant="link"
      size="sm"
      disabled={bulk.isPending}
      onClick={() => run().catch((e: Error) => toast.error(e.message))}
      className="h-auto p-0 text-xs underline underline-offset-3 max-md:min-h-11"
    >
      Retry all
    </Button>
  );
}

export function KpiCard({
  pending,
  queues,
  finished,
  previous,
  now,
}: {
  pending: number;
  queues: TypeQueue[];
  finished: Finished;
  previous: Finished;
  now: number;
}) {
  const oldest = queues.length ? now - Math.min(...queues.map((q) => Date.parse(q.oldestAvailableAt))) : null;
  const rate = rateOf(finished);
  const prev = rateOf(previous);
  const delta = rate !== null && prev !== null ? (rate - prev) * 100 : null;

  return (
    <Card className="gap-0 py-0">
      <div className="grid grid-cols-3 divide-x divide-border lg:grid-cols-1 lg:divide-x-0 lg:divide-y">
        <Kpi label="Queue" value={formatNumber(pending)} tone={pendingTone(oldest)}>
          {oldest === null ? 'pending · nothing waiting' : `pending · oldest waits ${formatDuration(oldest)}`}
        </Kpi>
        <Kpi label="Success · 24h" value={formatPercent(rate)} tone={rateTone(rate)}>
          {delta === null
            ? `${formatNumber(finished.success + finished.failed)} jobs`
            : `${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(1)} pts vs previous 24h`}
        </Kpi>
        <Kpi label="Failed · 24h" value={formatNumber(finished.failed)} tone={failedTone(finished.failed)}>
          {finished.failed > 0 ? <RetryAll failed={finished.failed} /> : 'none in 24h'}
        </Kpi>
      </div>
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useOverview } from '@/api/queries';
import { BlockError } from '@/components/block-error';
import { PageHeader } from '@/components/page-header';
import { AlertBanner } from '@/features/overview/alert-banner';
import { Fleet } from '@/features/overview/fleet';
import { KpiCard } from '@/features/overview/kpi-card';
import { PendingByType } from '@/features/overview/pending-by-type';
import { ThroughputChart } from '@/features/overview/throughput-chart';

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Placeholder({ className, error }: { className: string; error?: React.ReactNode }) {
  return <div className={`rounded-xl bg-card p-4 ring-1 ring-foreground/10 ${className}`}>{error}</div>;
}

function Overview() {
  const { data, isError, error, dataUpdatedAt, refetch } = useOverview();
  const now = useNow();

  const failure =
    isError && !data ? (
      <BlockError message={error.message} lastGoodAt={dataUpdatedAt} onRetry={() => refetch()} />
    ) : null;

  return (
    <>
      <PageHeader title="Overview" />
      {data ? (
        <>
          <AlertBanner alerts={data.alerts} now={now} />
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <Fleet workers={data.workers} pending={data.counts.pending} p95={data.runP95ByType} now={now} />
            <div className="flex flex-col gap-3">
              <KpiCard
                pending={data.counts.pending}
                failedNow={data.counts.failed}
                queues={data.pendingByType}
                finished={data.finished24H}
                previous={data.finishedPrev24H}
                now={now}
              />
              <PendingByType queues={data.pendingByType} />
            </div>
            <div className="lg:col-span-2">
              <ThroughputChart buckets={data.throughput} />
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <Placeholder className="h-80" error={failure} />
          <div className="flex flex-col gap-3">
            <Placeholder className="h-44" />
            <Placeholder className="h-28" />
          </div>
          <Placeholder className="h-60 lg:col-span-2" />
        </div>
      )}
    </>
  );
}

export const Route = createFileRoute('/')({ component: Overview });

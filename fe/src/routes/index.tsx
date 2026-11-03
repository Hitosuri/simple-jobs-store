import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useOverview } from '@/api/queries';
import { BlockError } from '@/components/block-error';
import { PageHeader } from '@/components/page-header';
import { AlertBanner } from '@/features/overview/alert-banner';
import { Fleet } from '@/features/overview/fleet';
import { KpiCard } from '@/features/overview/kpi-card';
import { oldestWait } from '@/features/overview/summary';
import { isConnectionFailure } from '@/lib/live';

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

  const failure = isError ? (
    <BlockError message={error.message} lastGoodAt={dataUpdatedAt} onRetry={() => refetch()} />
  ) : null;

  return (
    <>
      <PageHeader title="Overview" />
      {data ? (
        <>
          {failure && !isConnectionFailure(error) && (
            <div className="mb-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">{failure}</div>
          )}
          <AlertBanner alerts={data.alerts} workers={data.workers} now={now} />
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <Fleet
              workers={data.workers}
              alerts={data.alerts}
              failed={Math.min(data.counts.failed, data.finished24H.failed)}
              oldestWaitMs={oldestWait(data.pendingByType, now)}
              p95={data.runP95ByType}
              now={now}
            />
            <KpiCard
              pending={data.counts.pending}
              failedNow={data.counts.failed}
              queues={data.pendingByType}
              finished={data.finished24H}
              previous={data.finishedPrev24H}
              now={now}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <Placeholder className="h-80" error={failure} />
          <Placeholder className="h-80" />
        </div>
      )}
    </>
  );
}

export const Route = createFileRoute('/')({ component: Overview });

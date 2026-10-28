import { useMemo } from 'react';
import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useStats } from '@/api/queries';
import type { StatsRange } from '@/api/types';
import { BlockError } from '@/components/block-error';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FinishedChart } from '@/features/stats/finished-chart';
import { KpiRow } from '@/features/stats/kpi-row';
import { TopErrors } from '@/features/stats/top-errors';
import { TypeTable } from '@/features/stats/type-table';

const RANGES: StatsRange[] = ['1h', '24h', '7d'];
const STATS_DEFAULTS = { range: '24h' } as const;
const statsSearchSchema = z.object({ range: z.enum(RANGES).catch(STATS_DEFAULTS.range) });

function StatsScreen() {
  const rawSearch = Route.useSearch();
  const { range } = useMemo(() => statsSearchSchema.parse(rawSearch), [rawSearch]);
  const navigate = useNavigate();
  const stats = useStats(range);

  let body: React.ReactNode;
  if (!stats.data) {
    body = stats.isError ? (
      <Card className="px-4">
        <BlockError message={stats.error.message} lastGoodAt={stats.dataUpdatedAt} onRetry={() => stats.refetch()} />
      </Card>
    ) : (
      <>
        <div className="h-24 rounded-lg bg-inset" />
        <div className="h-72 rounded-lg bg-inset" />
      </>
    );
  } else {
    const { kpis, buckets, byType, topErrors } = stats.data;
    body = (
      <>
        {stats.isError && (
          <Card className="px-4">
            <BlockError
              message={stats.error.message}
              lastGoodAt={stats.dataUpdatedAt}
              onRetry={() => stats.refetch()}
            />
          </Card>
        )}
        <KpiRow kpis={kpis} range={range} />
        {kpis.finished.value === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs finished in this range</p>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
              <FinishedChart buckets={buckets} range={range} />
              <TopErrors errors={topErrors} />
            </div>
            <TypeTable rows={byType} />
          </>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Stats"
        actions={
          <ToggleGroup
            value={[range]}
            onValueChange={(v) => v[0] && navigate({ to: '/stats', search: { range: v[0] as StatsRange } })}
            variant="outline"
            spacing={0}
            aria-label="Time range"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r} value={r} className="max-md:h-11 max-md:min-w-11">
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <div className="flex flex-col gap-3">{body}</div>
    </>
  );
}

export const Route = createFileRoute('/stats')({
  validateSearch: (raw: Record<string, unknown>): Partial<z.output<typeof statsSearchSchema>> =>
    statsSearchSchema.parse(raw),
  search: { middlewares: [stripSearchParams(STATS_DEFAULTS)] },
  component: StatsScreen,
});

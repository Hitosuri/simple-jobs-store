import type { JobCounts, JobStatus } from '@/api/types';
import { statusLabel } from '@/components/status-badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatNumber } from '@/lib/format';

const STATUSES: JobStatus[] = ['pending', 'running', 'success', 'failed', 'cancelled'];

export function StatusTabs({
  value,
  counts,
  onChange,
}: {
  value: JobStatus | undefined;
  counts: JobCounts | undefined;
  onChange: (status: JobStatus | undefined) => void;
}) {
  const total = counts ? STATUSES.reduce((n, s) => n + counts[s], 0) : undefined;
  const label = (name: string, n: number | undefined) => (
    <>
      {name}{' '}
      <span className="text-xs text-muted-foreground tabular-nums">{n === undefined ? '' : formatNumber(n)}</span>
    </>
  );
  return (
    <Tabs
      className="shrink-0"
      value={value ?? 'all'}
      onValueChange={(v) => onChange(v === 'all' ? undefined : (v as JobStatus))}
    >
      <TabsList variant="line" className="w-full flex-wrap group-data-horizontal/tabs:h-auto justify-start gap-1 pb-2">
        <TabsTrigger value="all" className="h-8 flex-none px-3 max-md:min-h-11">
          {label('All', total)}
        </TabsTrigger>
        {STATUSES.map((s) => (
          <TabsTrigger key={s} value={s} className="h-8 flex-none px-3 max-md:min-h-11">
            {label(statusLabel(s), counts?.[s])}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

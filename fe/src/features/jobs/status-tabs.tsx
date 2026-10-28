import type { JobCounts, JobStatus } from '@/api/types';
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
      {name}
      <span className="text-xs text-muted-foreground tabular-nums">{n === undefined ? '' : formatNumber(n)}</span>
    </>
  );
  return (
    <Tabs value={value ?? 'all'} onValueChange={(v) => onChange(v === 'all' ? undefined : (v as JobStatus))}>
      <div className="max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
        <TabsList variant="line" className="h-auto gap-1 pb-2">
          <TabsTrigger value="all" className="px-3 max-md:min-h-11">
            {label('all', total)}
          </TabsTrigger>
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s} className="px-3 max-md:min-h-11">
              {label(s, counts?.[s])}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}

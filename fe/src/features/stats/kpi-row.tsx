import type { Stats, StatsRange } from '@/api/types';
import { Card } from '@/components/ui/card';
import { rateTone, toneClass } from '@/features/overview/thresholds';
import { formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { formatDelta, type DeltaKind } from './delta';

const dash = '\u{2014}';

export function KpiRow({ kpis, range }: { kpis: Stats['kpis']; range: StatsRange }) {
  const cells: {
    label: string;
    value: string;
    tone?: string;
    kind: DeltaKind;
    kpi: Stats['kpis'][keyof Stats['kpis']];
  }[] = [
    {
      label: 'Finished',
      value: kpis.finished.value === null ? dash : formatNumber(kpis.finished.value),
      kind: 'count',
      kpi: kpis.finished,
    },
    {
      label: 'Success rate',
      value: formatPercent(kpis.successRate.value),
      tone: toneClass[rateTone(kpis.successRate.value)],
      kind: 'rate',
      kpi: kpis.successRate,
    },
    {
      label: 'Wait before claim p95',
      value: kpis.waitP95Ms.value === null ? dash : formatDuration(kpis.waitP95Ms.value),
      kind: 'ms',
      kpi: kpis.waitP95Ms,
    },
    {
      label: 'Slot utilisation (approx.)',
      value: formatPercent(kpis.utilisation.value),
      kind: 'ratio',
      kpi: kpis.utilisation,
    },
  ];

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        {cells.map(({ label, value, tone, kind, kpi }) => (
          <div key={label} className="min-w-0 bg-card px-4 py-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
            <div className={cn('text-2xl font-semibold tracking-tight tabular-nums', tone)}>{value}</div>
            <div className="min-h-4 text-xs text-muted-foreground tabular-nums">
              {formatDelta(kpi.value, kpi.previous, kind, range)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

import type { Stats, StatsRange } from '@/api/types';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { pendingTone, rateTone, toneClass } from '@/features/overview/thresholds';
import { formatDuration, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { formatDelta, formatRate, type DeltaKind } from './delta';

const dash = '-';

export function KpiRow({ kpis, range }: { kpis: Stats['kpis']; range: StatsRange }) {
  const cells: {
    label: string;
    hint?: string;
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
      label: 'Final success',
      hint: 'Finished jobs that ended succeeded rather than failed, after any retries. Cancelled jobs are left out.',
      value: formatRate(kpis.successRate.value, kpis.finished.value ?? 0),
      tone: toneClass[rateTone(kpis.successRate.value)],
      kind: 'rate',
      kpi: kpis.successRate,
    },
    {
      label: 'Wait to start (p95)',
      hint: '95% of jobs were picked up by a worker within this time after they became ready to run.',
      value: kpis.waitP95Ms.value === null ? dash : formatDuration(kpis.waitP95Ms.value),
      tone: toneClass[pendingTone(kpis.waitP95Ms.value)],
      kind: 'ms',
      kpi: kpis.waitP95Ms,
    },
    {
      label: 'Slots busy',
      hint: 'Time spent running jobs, as a share of the worker slots online now. Approximate: workers that came or went during the range count as if they were online the whole time.',
      value: formatRate(kpis.utilisation.value, 0),
      kind: 'ratio',
      kpi: kpis.utilisation,
    },
  ];

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        {cells.map(({ label, hint, value, tone, kind, kpi }) => (
          <div key={label} className="min-w-0 bg-card px-4 py-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {hint ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button type="button" className="cursor-help underline decoration-dotted underline-offset-2" />
                    }
                  >
                    {label}
                  </TooltipTrigger>
                  <TooltipContent>{hint}</TooltipContent>
                </Tooltip>
              ) : (
                label
              )}
            </div>
            <div className={cn('text-2xl font-semibold tracking-tight tabular-nums', tone)}>{value}</div>
            <div className="truncate text-xs text-muted-foreground tabular-nums">
              {formatDelta(kpi.value, kpi.previous, kind, range) ?? 'No earlier figure'}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

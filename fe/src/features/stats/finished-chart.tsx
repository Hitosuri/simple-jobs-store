import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import type { StatsBucket, StatsRange } from '@/api/types';
import { statusLabel } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';

const SERIES = ['success', 'failed', 'cancelled'] as const;

const config = {
  success: { label: statusLabel('success'), color: 'var(--ok)' },
  failed: { label: statusLabel('failed'), color: 'var(--bad)' },
  cancelled: { label: statusLabel('cancelled'), color: 'var(--muted-foreground)' },
} satisfies ChartConfig;

const RANGE_TEXT: Record<StatsRange, { title: string; current: string }> = {
  '1h': { title: 'Finished per 5 minutes - last hour', current: 'current 5 minutes so far' },
  '24h': { title: 'Finished per hour - last 24 hours', current: 'current hour so far' },
  '7d': { title: 'Finished per 6 hours - last 7 days', current: 'current 6 hours so far' },
};

const clock = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dayTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const TICKS = 6;

export function FinishedChart({ buckets, range }: { buckets: StatsBucket[]; range: StatsRange }) {
  const axis = (iso: string) => (range === '7d' ? day : clock).format(Date.parse(iso));
  const step = Math.max(1, Math.ceil(buckets.length / TICKS));
  const ticks = buckets.filter((_, i) => i % step === 0).map((b) => b.start);
  const series = SERIES.filter((k) => buckets.some((b) => b[k] > 0));
  const last = buckets.length - 1;
  const tooltipLabel = (start: string) =>
    `${dayTime.format(Date.parse(start))}${start === buckets[last]?.start ? ` · ${RANGE_TEXT[range].current}` : ''}`;
  return (
    <Card className="gap-2 px-4">
      <h2 className="text-[13px] font-semibold">{RANGE_TEXT[range].title}</h2>
      <ChartContainer config={config} className="aspect-auto h-56 w-full justify-start lg:h-auto lg:min-h-56 lg:flex-1">
        <BarChart data={buckets} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis
            dataKey="start"
            ticks={ticks}
            tickFormatter={axis}
            interval={0}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            angle={0}
          />
          <YAxis allowDecimals={false} tickCount={4} width={36} tickLine={false} axisLine={false} />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent labelFormatter={(_, p) => tooltipLabel(p[0].payload.start)} />}
          />
          {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
          {series.map((k) => (
            <Bar key={k} dataKey={k} stackId="a" fill={`var(--color-${k})`} radius={0} isAnimationActive={false}>
              {buckets.map((b, i) => (
                <Cell key={b.start} fillOpacity={i === last ? 0.5 : 1} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
    </Card>
  );
}

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { StatsBucket, StatsRange } from '@/api/types';
import { Card } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';

const config = {
  success: { label: 'success', color: 'var(--ok)' },
  failed: { label: 'failed', color: 'var(--bad)' },
  cancelled: { label: 'cancelled', color: 'var(--muted-foreground)' },
} satisfies ChartConfig;

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
  return (
    <Card className="gap-2 px-4">
      <h2 className="text-[13px] font-semibold">Finished per bucket · last {range}</h2>
      <ChartContainer config={config} className="aspect-auto h-56 w-full justify-start">
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
            content={<ChartTooltipContent labelFormatter={(_, p) => dayTime.format(Date.parse(p[0].payload.start))} />}
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="success" stackId="a" fill="var(--color-success)" radius={0} isAnimationActive={false} />
          <Bar dataKey="failed" stackId="a" fill="var(--color-failed)" radius={0} isAnimationActive={false} />
          <Bar dataKey="cancelled" stackId="a" fill="var(--color-cancelled)" radius={0} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <p className="text-xs text-muted-foreground">Includes the current partial bucket.</p>
    </Card>
  );
}

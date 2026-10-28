import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { ThroughputBucket } from '@/api/types';
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
} satisfies ChartConfig;

const clock = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const time = (iso: string) => clock.format(Date.parse(iso));

export function ThroughputChart({ buckets }: { buckets: ThroughputBucket[] }) {
  const ticks = buckets.filter((_, i) => i % 3 === 0 || i === buckets.length - 1).map((b) => b.start);
  const last = buckets.at(-1)?.start;
  return (
    <Card className="gap-2 px-4">
      <div className="text-xs font-medium text-muted-foreground">Finished per 30 min · last 6h</div>
      <ChartContainer config={config} className="aspect-auto h-44 w-full justify-start">
        <BarChart data={buckets} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis
            dataKey="start"
            ticks={ticks}
            tickFormatter={(v: string) => (v === last ? 'now' : time(v))}
            interval={0}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            angle={0}
          />
          <YAxis allowDecimals={false} tickCount={4} width={36} tickLine={false} axisLine={false} />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent labelFormatter={(_, p) => time(p[0].payload.start)} />}
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="success" stackId="a" fill="var(--color-success)" radius={0} isAnimationActive={false} />
          <Bar dataKey="failed" stackId="a" fill="var(--color-failed)" radius={0} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </Card>
  );
}

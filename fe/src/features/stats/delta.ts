import type { StatsRange } from '@/api/types';

export type DeltaKind = 'count' | 'rate' | 'ms' | 'ratio';

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

export function formatDelta(
  current: number | null,
  previous: number | null,
  kind: DeltaKind,
  range: StatsRange,
): string | null {
  if (current === null || previous === null) return null;
  const baseline = `vs previous ${range}`;
  if (kind === 'rate' || kind === 'ratio') {
    const tenths = Math.round((current - previous) * 1000);
    return `${sign(tenths)}${(Math.abs(tenths) / 10).toFixed(1)} pts ${baseline}`;
  }
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${sign(pct)}${Math.abs(pct)}% ${baseline}`;
}

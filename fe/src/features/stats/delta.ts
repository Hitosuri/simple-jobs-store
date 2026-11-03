import type { StatsRange } from '@/api/types';

export type DeltaKind = 'count' | 'rate' | 'ms' | 'ratio';

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '');

export function formatDelta(
  current: number | null,
  previous: number | null,
  kind: DeltaKind,
  range: StatsRange,
): string | null {
  if (current === null || previous === null) return null;
  const baseline = `vs previous ${range}`;
  if (kind === 'rate' || kind === 'ratio') {
    const pts = Math.round((current - previous) * 100);
    return `${sign(pts)}${Math.abs(pts)} ${Math.abs(pts) === 1 ? 'pt' : 'pts'} ${baseline}`;
  }
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${sign(pct)}${Math.abs(pct)}% ${baseline}`;
}

/**
 * A ratio as a percent, with one decimal only for samples of 1000 or more. Rounds down, so a
 * ratio below 1 never reads 100% and a value under a threshold never reads as the threshold;
 * a non-zero ratio never reads 0%.
 */
export function formatRate(ratio: number | null, sample: number): string {
  if (ratio === null) return '-';
  const digits = sample >= 1000 ? 1 : 0;
  const scale = 10 ** digits;
  let pct = Math.floor(ratio * 100 * scale + 1e-9) / scale;
  if (ratio > 0) pct = Math.max(pct, 1 / scale);
  return `${pct.toFixed(digits)}%`;
}

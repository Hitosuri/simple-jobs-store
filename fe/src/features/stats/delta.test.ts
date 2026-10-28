import { describe, expect, it } from 'vitest';
import { formatDelta } from './delta';

describe('formatDelta', () => {
  it.each([
    [1284, 1146, 'count', '24h', '+12% vs previous 24h'],
    [900, 1000, 'count', '1h', '-10% vs previous 1h'],
    [1000, 1001, 'count', '24h', '0% vs previous 24h'],
    [0.962, 0.97, 'rate', '24h', '-0.8 pts vs previous 24h'],
    [0.975, 0.96, 'rate', '1h', '+1.5 pts vs previous 1h'],
    [0.9601, 0.96, 'rate', '24h', '0.0 pts vs previous 24h'],
    [0.9599, 0.96, 'ratio', '24h', '0.0 pts vs previous 24h'],
    [3000, 2000, 'ms', '24h', '+50% vs previous 24h'],
  ] as const)('%s vs %s (%s, %s)', (cur, prev, kind, range, out) => {
    expect(formatDelta(cur, prev, kind, range)).toBe(out);
  });

  it.each([
    [10, null],
    [null, 10],
    [10, 0],
  ])('returns null for %s vs %s', (cur, prev) => {
    expect(formatDelta(cur, prev, 'count', '24h')).toBeNull();
  });

  it('returns null for a missing previous rate', () => {
    expect(formatDelta(0.9, null, 'rate', '7d')).toBeNull();
  });
});

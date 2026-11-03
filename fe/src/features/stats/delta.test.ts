import { describe, expect, it } from 'vitest';
import { formatDelta, formatRate } from './delta';

describe('formatDelta', () => {
  it.each([
    [1284, 1146, 'count', '24h', '+12% vs previous 24h'],
    [900, 1000, 'count', '1h', '-10% vs previous 1h'],
    [1000, 1001, 'count', '24h', '0% vs previous 24h'],
    [0.962, 0.97, 'rate', '24h', '-1 pt vs previous 24h'],
    [0.975, 0.96, 'rate', '1h', '+2 pts vs previous 1h'],
    [0.61, 0.001, 'ratio', '1h', '+61 pts vs previous 1h'],
    [0.9601, 0.96, 'rate', '24h', '0 pts vs previous 24h'],
    [0.9599, 0.96, 'ratio', '24h', '0 pts vs previous 24h'],
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

describe('formatRate', () => {
  it.each([
    [0.973, 149, '97%'],
    [1, 149, '100%'],
    [0, 149, '0%'],
    [0.9973, 149, '99%'],
    [0.948, 149, '94%'],
    [0.29, 149, '29%'],
    [0.002, 149, '1%'],
    [0.9734, 1200, '97.3%'],
    [0.99996, 5000, '99.9%'],
    [null, 0, '-'],
  ])('%s of %s -> %s', (ratio, sample, out) => {
    expect(formatRate(ratio, sample)).toBe(out);
  });
});

import { describe, expect, it } from 'vitest';
import { formatAgo, formatDuration, formatNumber, formatPercent } from './format';

describe('formatDuration', () => {
  it.each([
    [3_000, '3s'],
    [48_000, '48s'],
    [62_000, '1m 02s'],
    [2_530_000, '42m 10s'],
    [3_780_000, '1h 03m'],
    [90_000_000, '1d 01h'],
  ])('%i -> %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1451)).toBe('1,451');
  });
});

describe('formatPercent', () => {
  it('formats a ratio', () => {
    expect(formatPercent(0.962)).toBe('96.2%');
  });
  it('honors digits', () => {
    expect(formatPercent(0.5, 0)).toBe('50%');
  });
  it('dashes null', () => {
    expect(formatPercent(null)).toBe('-');
  });
});

describe('formatAgo', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it.each([
    ['2026-10-28T11:48:00Z', '12m ago'],
    ['2026-10-28T11:59:30Z', '30s ago'],
    ['2026-10-28T09:00:00Z', '3h ago'],
    ['2026-10-26T12:00:00Z', '2d ago'],
  ])('%s -> %s', (iso, expected) => {
    expect(formatAgo(iso, now)).toBe(expected);
  });
});

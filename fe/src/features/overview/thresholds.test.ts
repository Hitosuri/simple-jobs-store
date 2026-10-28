import { describe, expect, it } from 'vitest';
import { elapsedTone, failedTone, pendingTone, rateTone } from './thresholds';

describe('pendingTone', () => {
  it.each([
    [0, 'fg'],
    [300_000, 'fg'],
    [300_001, 'warn'],
  ])('%i -> %s', (ms, tone) => expect(pendingTone(ms)).toBe(tone));
  it('null wait is fg', () => expect(pendingTone(null)).toBe('fg'));
});

describe('rateTone', () => {
  it.each([
    [1, 'fg'],
    [0.95, 'fg'],
    [0.9499, 'warn'],
    [0.8, 'warn'],
    [0.7999, 'bad'],
    [0, 'bad'],
    [null, 'fg'],
  ])('%s -> %s', (rate, tone) => expect(rateTone(rate)).toBe(tone));
});

describe('failedTone', () => {
  it.each([
    [0, 'fg'],
    [1, 'bad'],
  ])('%i -> %s', (n, tone) => expect(failedTone(n)).toBe(tone));
});

describe('elapsedTone', () => {
  it.each([
    [10_000, 60_000, 'fg'],
    [60_000, 60_000, 'fg'],
    [60_001, 60_000, 'warn'],
    [10_000_000, undefined, 'fg'],
  ])('%i vs p95 %s -> %s', (ms, p95, tone) => expect(elapsedTone(ms, p95)).toBe(tone));
});

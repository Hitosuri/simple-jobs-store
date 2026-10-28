import { describe, expect, it } from 'vitest';
import { attemptsShown } from './job-cells';

describe('attemptsShown', () => {
  it('counts the in-flight attempt of a running job', () => {
    expect(attemptsShown({ status: 'running', attemptsUsed: 1 })).toBe(2);
  });

  it('uses attemptsUsed for every other status', () => {
    for (const status of ['pending', 'success', 'failed', 'cancelled'] as const) {
      expect(attemptsShown({ status, attemptsUsed: 2 })).toBe(2);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { primaryAction, secondaryActions } from './job-actions';

describe('primaryAction', () => {
  it('is Retry for jobs that stopped without succeeding', () => {
    expect(primaryAction({ status: 'failed' })).toBe('retry');
    expect(primaryAction({ status: 'cancelled' })).toBe('retry');
  });

  it('is Cancel for jobs still queued or running', () => {
    expect(primaryAction({ status: 'pending' })).toBe('cancel');
    expect(primaryAction({ status: 'running' })).toBe('cancel');
  });

  it('is Replay for a succeeded job', () => {
    expect(primaryAction({ status: 'success' })).toBe('replay');
  });
});

describe('secondaryActions', () => {
  it('lists only applicable actions, without the primary, Delete last', () => {
    expect(secondaryActions({ status: 'pending' })).toEqual(['priority']);
    expect(secondaryActions({ status: 'running' })).toEqual([]);
    expect(secondaryActions({ status: 'failed' })).toEqual(['delete']);
    expect(secondaryActions({ status: 'success' })).toEqual(['delete']);
  });
});

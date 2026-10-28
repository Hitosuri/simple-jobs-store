import { describe, expect, it } from 'vitest';
import type { Attempt } from '@/api/types';
import { buildTimeline } from './timeline';

const at = (n: number, startedAt: string, endedAt: string | null, outcome: Attempt['outcome']): Attempt => ({
  attemptNo: n,
  workerId: `w${n}`,
  outcome,
  error: null,
  errorDetail: null,
  startedAt,
  endedAt,
});

const a1 = at(1, '2026-01-01T10:00:00Z', '2026-01-01T10:08:00Z', 'lease_expired');
const a2 = at(2, '2026-01-01T11:00:00Z', '2026-01-01T11:01:00Z', 'failed');
const a3 = at(3, '2026-01-01T12:00:00Z', null, null);
const now = Date.parse('2026-01-01T12:30:00Z');

const label = (items: ReturnType<typeof buildTimeline>) =>
  items.map((i) => (i.kind === 'attempt' ? i.attempt.attemptNo : 'requeue'));

describe('buildTimeline', () => {
  it('orders attempts newest first', () => {
    expect(label(buildTimeline([a1, a3, a2], null, now))).toEqual([3, 2, 1]);
  });

  it('places the requeue marker between attempts before and after requeuedAt', () => {
    expect(label(buildTimeline([a1, a2, a3], '2026-01-01T11:30:00Z', now))).toEqual([3, 'requeue', 2, 1]);
  });

  it('puts the marker on top when no attempt started after requeuedAt', () => {
    const items = buildTimeline([a1, a2], '2026-01-01T13:00:00Z', now);
    expect(label(items)).toEqual(['requeue', 2, 1]);
    expect(items[0]).toEqual({ kind: 'requeue', at: '2026-01-01T13:00:00Z' });
  });

  it('puts the marker last when every attempt started after requeuedAt', () => {
    expect(label(buildTimeline([a1, a2], '2026-01-01T09:00:00Z', now))).toEqual([2, 1, 'requeue']);
  });

  it('measures finished attempts by endedAt and the running one by now', () => {
    const items = buildTimeline([a1, a2, a3], null, now);
    expect(items.map((i) => i.kind === 'attempt' && i.durationMs)).toEqual([30 * 60_000, 60_000, 8 * 60_000]);
  });

  it('has no duration for an ended-less attempt that already has an outcome', () => {
    const odd = at(4, '2026-01-01T12:00:00Z', null, 'released');
    expect(buildTimeline([odd], null, now)[0]).toMatchObject({ durationMs: null });
  });
});

import { describe, expect, it } from 'vitest';
import type { AttemptRow, Worker } from '@/api/types';
import { groupByMachine, layoutLanes, machinesSearchSchema, summarizeAttempts } from './lanes';

const FROM = Date.parse('2026-01-01T00:00:00Z');
const TO = FROM + 100_000;
const iso = (offsetMs: number) => new Date(FROM + offsetMs).toISOString();

function attempt(over: Partial<AttemptRow>): AttemptRow {
  return {
    jobId: 1,
    jobType: 't',
    attemptNo: 1,
    workerId: 'w1',
    outcome: 'succeeded',
    startedAt: iso(10_000),
    endedAt: iso(30_000),
    ...over,
  };
}

describe('layoutLanes', () => {
  it('places a bar by percentage of the window', () => {
    const bars = layoutLanes([attempt({})], FROM, TO).get('w1');
    expect(bars).toEqual([{ jobId: 1, type: 't', leftPct: 10, widthPct: 20, failed: false }]);
  });

  it('clips at both edges and drops attempts outside the window', () => {
    const rows = [
      attempt({ jobId: 1, startedAt: iso(-50_000), endedAt: iso(20_000) }),
      attempt({ jobId: 2, startedAt: iso(90_000), endedAt: iso(150_000) }),
      attempt({ jobId: 3, startedAt: iso(-50_000), endedAt: iso(-10_000) }),
      attempt({ jobId: 4, startedAt: iso(110_000), endedAt: iso(120_000) }),
    ];
    const bars = layoutLanes(rows, FROM, TO).get('w1');
    expect(bars?.map((b) => [b.jobId, b.leftPct, b.widthPct])).toEqual([
      [1, 0, 20],
      [2, 90, 10],
    ]);
  });

  it('runs an open attempt to the end of the window', () => {
    const bars = layoutLanes([attempt({ outcome: null, endedAt: null })], FROM, TO).get('w1');
    expect(bars?.[0]).toMatchObject({ leftPct: 10, widthPct: 90, failed: false });
  });

  it('flags every outcome except succeeded and null as failed', () => {
    const outcomes = ['succeeded', null, 'failed', 'lease_expired', 'cancelled'] as const;
    const rows = outcomes.map((outcome, i) => attempt({ jobId: i, outcome }));
    expect(
      layoutLanes(rows, FROM, TO)
        .get('w1')
        ?.map((b) => b.failed),
    ).toEqual([false, false, true, true, true]);
  });

  it('keeps one lane per worker', () => {
    const lanes = layoutLanes([attempt({ workerId: 'a' }), attempt({ workerId: 'b' })], FROM, TO);
    expect([...lanes.keys()]).toEqual(['a', 'b']);
  });
});

describe('groupByMachine', () => {
  const w = (id: string, ip: string) => ({ id, ip }) as Worker;

  it('groups by ip sorted numerically by ip', () => {
    const groups = groupByMachine([w('a', '10.0.0.10'), w('b', '10.0.0.9'), w('c', '10.0.0.10')]);
    expect(groups.map((g) => [g.ip, g.workers.map((x) => x.id)])).toEqual([
      ['10.0.0.9', ['b']],
      ['10.0.0.10', ['a', 'c']],
    ]);
  });
});

describe('summarizeAttempts', () => {
  it('counts ended attempts, success rate and mean run time', () => {
    const rows = [
      attempt({ outcome: 'succeeded', startedAt: iso(0), endedAt: iso(10_000) }),
      attempt({ outcome: 'failed', startedAt: iso(0), endedAt: iso(30_000) }),
      attempt({ outcome: null, endedAt: null }),
    ];
    expect(summarizeAttempts(rows)).toEqual({ done: 2, successRate: 0.5, meanRunMs: 20_000 });
  });

  it('has no rate or mean when nothing ended', () => {
    expect(summarizeAttempts([attempt({ outcome: null, endedAt: null })])).toEqual({
      done: 0,
      successRate: null,
      meanRunMs: null,
    });
  });
});

describe('machinesSearchSchema', () => {
  it('falls back to defaults on bad input', () => {
    expect(machinesSearchSchema.parse({ range: '2h', offline: 'x' })).toEqual({ range: '1h', offline: false });
    expect(machinesSearchSchema.parse({ range: '6h', offline: true })).toEqual({ range: '6h', offline: true });
  });
});

import { describe, expect, it } from 'vitest';
import type { Alert } from '@/api/types';
import { alertText, fleetVerdict, groupAlerts, oldestWait, roughDuration, successShown } from './summary';

const calm = { lostWorkers: [], failed: 0, busy: 3, total: 8, oldestWaitMs: null };

describe('fleetVerdict', () => {
  it('all clear when nothing is wrong', () => expect(fleetVerdict(calm)).toEqual({ tone: 'fg', text: 'All clear' }));

  it('one lost worker is named', () =>
    expect(fleetVerdict({ ...calm, lostWorkers: ['Ghost worker'], failed: 3 })).toEqual({
      tone: 'bad',
      text: 'Ghost worker stopped responding',
    }));

  it('several lost workers are counted', () =>
    expect(fleetVerdict({ ...calm, lostWorkers: ['a', 'b'] }).text).toBe('2 workers stopped responding'));

  it('failed jobs beat a backed-up queue', () =>
    expect(fleetVerdict({ ...calm, failed: 1, busy: 8, oldestWaitMs: 600_000 })).toEqual({
      tone: 'bad',
      text: '1 job failed',
    }));

  it('queue backs up when every slot is busy and the oldest waits past 5 min', () =>
    expect(fleetVerdict({ ...calm, busy: 8, oldestWaitMs: 420_000 })).toEqual({
      tone: 'warn',
      text: 'Queue backing up',
      detail: 'oldest waiting 7m',
    }));

  it('no warn while a slot is free', () => expect(fleetVerdict({ ...calm, oldestWaitMs: 420_000 }).tone).toBe('fg'));

  it('no warn at exactly 5 min', () =>
    expect(fleetVerdict({ ...calm, busy: 8, oldestWaitMs: 300_000 }).tone).toBe('fg'));

  it('no workers online counts as no free slot', () =>
    expect(fleetVerdict({ ...calm, busy: 0, total: 0, oldestWaitMs: 400_000 }).tone).toBe('warn'));
});

describe('successShown', () => {
  it('nothing finished', () => expect(successShown({ success: 0, failed: 0 })).toEqual({ text: '-', rate: null }));
  it('small sample as a count', () =>
    expect(successShown({ success: 8, failed: 1 })).toEqual({ text: '8 of 9', rate: 8 / 9 }));
  it('whole percent, rounded down', () =>
    expect(successShown({ success: 132, failed: 4 })).toEqual({ text: '97%', rate: 0.97 }));
  it('never 100% with a failure', () => expect(successShown({ success: 999, failed: 1 }).text).toBe('99%'));
  it('float noise does not drop a point', () => expect(successShown({ success: 29, failed: 71 }).text).toBe('29%'));
  it('all succeeded', () => expect(successShown({ success: 20, failed: 0 }).text).toBe('100%'));
});

describe('oldestWait', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  const q = (at: string) => ({ type: 't', pending: 1, oldestAvailableAt: at });
  it('none when nothing waits', () => expect(oldestWait([], now)).toBeNull());
  it('largest wait across types', () =>
    expect(oldestWait([q('2026-11-03T09:58:00Z'), q('2026-11-03T09:53:00Z')], now)).toBe(420_000));
  it('a future availableAt waits 0', () => expect(oldestWait([q('2026-11-03T10:01:00Z')], now)).toBe(0));
});

it('roughDuration keeps the largest unit', () => expect(roughDuration(23 * 60_000 + 32_000)).toBe('23m'));

describe('groupAlerts', () => {
  const alerts: Alert[] = [
    { kind: 'attempt_expired', workerId: 'w-dxf', jobId: 96, at: '2026-11-03T05:41:19Z' },
    { kind: 'attempt_expired', workerId: 'ghost', jobId: 27, at: '2026-11-03T05:41:44Z' },
    { kind: 'worker_lost', workerId: 'ghost', jobId: null, at: '2026-11-03T05:41:40Z' },
    { kind: 'attempt_expired', workerId: 'w-dxf', jobId: 111, at: '2026-11-03T05:42:19Z' },
  ];

  it('one entry per worker, lost first', () =>
    expect(groupAlerts(alerts)).toEqual([
      { workerId: 'ghost', lostAt: '2026-11-03T05:41:40Z', jobIds: [27], latestAt: '2026-11-03T05:41:44Z' },
      { workerId: 'w-dxf', lostAt: null, jobIds: [96, 111], latestAt: '2026-11-03T05:42:19Z' },
    ]));
});

describe('alertText', () => {
  const g = (lostAt: string | null, jobIds: number[]) => ({ workerId: 'w', lostAt, jobIds, latestAt: 'x' });
  it.each([
    [g('t', []), 'Ghost stopped responding 7m ago'],
    [g('t', [2]), 'Ghost stopped responding 7m ago while running job #2'],
    [g('t', [2, 5, 9, 11]), 'Ghost stopped responding 7m ago while running 4 jobs'],
    [g(null, [135]), 'Ghost timed out on job #135 7m ago'],
    [g(null, [96, 111, 113]), 'Ghost timed out on jobs #96, #111 and #113 7m ago'],
  ])('%j', (group, text) => expect(alertText(group, 'Ghost', '7m ago')).toBe(text));

  it('without a time', () =>
    expect(alertText(g('t', [2]), 'Ghost')).toBe('Ghost stopped responding while running job #2'));
});

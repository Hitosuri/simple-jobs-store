import { describe, expect, it } from 'vitest';
import type { Attempt, Job } from '@/api/types';
import { errorText, heroElapsed, reportLines, retryNote, spanText } from './wording';

const now = new Date(2026, 10, 3, 12, 20, 0).getTime();
const iso = (h: number, m: number, s = 0) => new Date(2026, 10, 3, h, m, s).toISOString();

const attempt = (n: number, outcome: Attempt['outcome'], error: string | null = null): Attempt => ({
  attemptNo: n,
  workerId: 'w1',
  outcome,
  error,
  errorDetail: null,
  startedAt: iso(12, n),
  endedAt: iso(12, n, 30),
});

describe('heroElapsed', () => {
  it('labels running, finished and waiting jobs', () => {
    const base = { startedAt: iso(12, 15), finishedAt: null, availableAt: iso(12, 0) };
    expect(heroElapsed({ ...base, status: 'running' }, now)).toEqual({ ms: 5 * 60_000, label: 'Running for' });
    expect(heroElapsed({ ...base, status: 'success', finishedAt: iso(12, 18) }, now)).toEqual({
      ms: 3 * 60_000,
      label: 'Ran for',
    });
    expect(heroElapsed({ ...base, status: 'pending' }, now)).toEqual({ ms: 20 * 60_000, label: 'Waiting for' });
  });

  it('counts down to a retry that is not due yet', () => {
    const job = { status: 'pending' as const, startedAt: null, finishedAt: null, availableAt: iso(12, 25) };
    expect(heroElapsed(job, now)).toEqual({ ms: 5 * 60_000, label: 'Ready in' });
  });

  it('has no figure for a job cancelled before it started', () => {
    const job = { status: 'cancelled' as const, startedAt: null, finishedAt: iso(12, 1), availableAt: iso(12, 0) };
    expect(heroElapsed(job, now)).toEqual({ ms: null, label: 'Never started' });
  });
});

describe('retryNote', () => {
  const pending: Pick<Job, 'status' | 'attemptsUsed' | 'maxAttempt' | 'availableAt' | 'error'> = {
    status: 'pending',
    attemptsUsed: 1,
    maxAttempt: 3,
    availableAt: iso(12, 25),
    error: 'boom',
  };

  it('leads with the failed attempt and the retry time', () => {
    expect(retryNote(pending, [attempt(1, 'failed', "KeyError: 'x'")], now)).toEqual({
      lead: "Attempt 1 failed: KeyError: 'x'",
      next: 'Retrying at Nov 3, 12:25:00 (attempt 2 of 3)',
    });
  });

  it('names a non-failure outcome by its label', () => {
    const note = retryNote({ ...pending, error: 'lease_expired' }, [attempt(1, 'lease_expired')], now);
    expect(note?.lead).toBe('Attempt 1: Lease expired');
  });

  it('uses the latest attempt and says when the retry is already due', () => {
    const job = { ...pending, attemptsUsed: 2, availableAt: iso(12, 10) };
    const note = retryNote(job, [attempt(2, 'failed', 'second'), attempt(1, 'failed', 'first')], now);
    expect(note).toEqual({
      lead: 'Attempt 2 failed: second',
      next: 'Retrying when a worker is free (attempt 3 of 3)',
    });
  });

  it('is absent for a fresh or requeued pending job and for other statuses', () => {
    expect(retryNote({ ...pending, attemptsUsed: 0 }, [attempt(1, 'failed')], now)).toBeNull();
    expect(retryNote({ ...pending, status: 'running' }, [attempt(1, 'failed')], now)).toBeNull();
    expect(retryNote(pending, [attempt(1, 'succeeded')], now)).toBeNull();
  });
});

describe('errorText', () => {
  it('shows stored outcome codes as labels and leaves messages alone', () => {
    expect(errorText('deadline_exceeded')).toBe('Deadline exceeded');
    expect(errorText('ValueError: bad')).toBe('ValueError: bad');
  });
});

describe('reportLines', () => {
  const two = [
    { type: 'callback' as const, config: { url: 'https://a.example/' } },
    { type: 'callback' as const, config: { url: 'https://b.example/' } },
  ];
  const job = (patch: Partial<Job>) => ({
    reports: two,
    reportStatus: null,
    reportRound: 0,
    reportCursor: 0,
    reportNextAt: null,
    ...patch,
  });
  const texts = (patch: Partial<Job>) => reportLines(job(patch), now).map((l) => l.text);

  it('is empty without targets', () => {
    expect(reportLines(job({ reports: null }), now)).toEqual([]);
  });

  it('waits for the job to finish', () => {
    expect(texts({})).toEqual(['Sent when the job finishes', 'Sent when the job finishes']);
  });

  it('marks the delivering target and the rest', () => {
    expect(texts({ reportStatus: 'success' })).toEqual(['Delivered', 'Not needed']);
    expect(texts({ reportStatus: 'success', reportCursor: 1 })).toEqual(['Failed once', 'Delivered']);
    expect(reportLines(job({ reportStatus: 'success' }), now)[0].tone).toBe('ok');
  });

  it('says sending now while a send is in flight', () => {
    expect(texts({ reportStatus: 'reporting' })).toEqual(['Sending now', 'Not tried yet']);
  });

  it('queues the first send and waits on the backup', () => {
    expect(texts({ reportStatus: 'pending', reportNextAt: iso(12, 20) })).toEqual(['Sending soon', 'Not tried yet']);
    expect(texts({ reportStatus: 'pending', reportCursor: 1, reportNextAt: iso(12, 25) })).toEqual([
      'Failed once',
      'Waiting to send at Nov 3, 12:25:00',
    ]);
  });

  it('counts retries per target across rounds', () => {
    expect(texts({ reportStatus: 'pending', reportRound: 1, reportNextAt: iso(12, 25) })).toEqual([
      'Waiting to retry at Nov 3, 12:25:00 (attempt 2)',
      'Failed once',
    ]);
    expect(texts({ reportStatus: 'pending', reportRound: 2, reportCursor: 1, reportNextAt: iso(12, 25) })).toEqual([
      'Failed 3 times',
      'Waiting to retry at Nov 3, 12:25:00 (attempt 3)',
    ]);
  });

  it('gives up on every target', () => {
    expect(texts({ reportStatus: 'failed', reportRound: 3 })).toEqual([
      'Gave up after 3 tries',
      'Gave up after 3 tries',
    ]);
  });
});

describe('spanText', () => {
  it('formats a span and drops unknown or negative ones', () => {
    expect(spanText('ran for', iso(12, 0), iso(12, 5))).toBe('ran for 5m 00s');
    expect(spanText('ran for', null, iso(12, 5))).toBeNull();
    expect(spanText('queued for', iso(12, 5), iso(12, 0))).toBeNull();
    expect(spanText('queued for', iso(12, 0), iso(12, 0))).toBeNull();
  });
});

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProgressStep } from '@/api/types';
import { attemptsShown, currentStep, ErrorLine, jobDuration, jobProgress, shownStepStatus } from './job-cells';

describe('ErrorLine', () => {
  const html = (status: 'failed' | 'cancelled', error: string | null) =>
    renderToString(createElement(ErrorLine, { job: { status, error } }));

  it('shows the error of a failed job', () => {
    expect(html('failed', 'boom')).toContain('boom');
  });

  it('renders nothing for other statuses or a missing error', () => {
    expect(html('cancelled', 'boom')).toBe('');
    expect(html('failed', null)).toBe('');
  });
});

describe('shownStepStatus', () => {
  it('keeps a running step running while the job runs', () => {
    expect(shownStepStatus('running', 'running')).toBe('running');
  });

  it('marks a running step stopped once the job stopped without succeeding', () => {
    for (const job of ['pending', 'failed', 'cancelled'] as const) {
      expect(shownStepStatus('running', job)).toBe('stopped');
    }
  });

  it('shows unfinished steps of a succeeded job as done', () => {
    expect(shownStepStatus('running', 'success')).toBe('done');
    expect(shownStepStatus('pending', 'success')).toBe('done');
    expect(shownStepStatus('skipped', 'success')).toBe('skipped');
  });

  it('leaves every other step status as reported', () => {
    for (const step of ['pending', 'done', 'failed', 'skipped'] as const) {
      expect(shownStepStatus(step, 'failed')).toBe(step);
    }
  });
});

describe('jobProgress', () => {
  const steps = [
    { id: 'a', status: 'done', current: null, total: null, percent: null, message: null },
    { id: 'b', status: 'running', current: null, total: null, percent: 40, message: null },
  ] satisfies ProgressStep[];

  it('averages the steps of a running or stopped job', () => {
    expect(jobProgress({ status: 'running', progress: steps })).toBe(70);
    expect(jobProgress({ status: 'failed', progress: steps })).toBe(70);
  });

  it('is 100 for a succeeded job whatever the last report said', () => {
    expect(jobProgress({ status: 'success', progress: steps })).toBe(100);
  });

  it('is null for a pending job, whose steps belong to an earlier attempt', () => {
    expect(jobProgress({ status: 'pending', progress: steps })).toBeNull();
  });

  it('is null without steps', () => {
    expect(jobProgress({ status: 'running', progress: null })).toBeNull();
  });
});

describe('jobDuration', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 3, 9, 0, s)).toISOString();
  const now = Date.parse(at(50));
  const job = { startedAt: at(10), finishedAt: at(40), availableAt: at(5) };

  it('is the live elapsed time of a running job', () => {
    expect(jobDuration({ ...job, status: 'running', finishedAt: null }, now)).toEqual({ kind: 'running', ms: 40_000 });
  });

  it('is finish minus start for a finished job', () => {
    expect(jobDuration({ ...job, status: 'success' }, now)).toEqual({ kind: 'finished', ms: 30_000 });
  });

  it('is the wait since availableAt for a pending job, even one that ran before', () => {
    expect(jobDuration({ ...job, status: 'pending' }, now)).toEqual({ kind: 'waiting', ms: 45_000 });
  });

  it('is the time left before a delayed pending job can be claimed', () => {
    expect(jobDuration({ ...job, status: 'pending', availableAt: at(59) }, now)).toEqual({ kind: 'ready', ms: 9_000 });
  });

  it('is null for a job cancelled before it started', () => {
    expect(jobDuration({ ...job, status: 'cancelled', startedAt: null }, now)).toBeNull();
  });
});

describe('currentStep', () => {
  const step = (id: string, status: ProgressStep['status']): ProgressStep => ({
    id,
    status,
    current: null,
    total: null,
    percent: null,
    message: null,
  });
  const progress = [step('download', 'done'), step('convert', 'running'), step('upload', 'pending')];

  it('is the running step of a running job', () => {
    expect(currentStep({ status: 'running', progress })?.id).toBe('convert');
  });

  it('is where a stopped job stopped, preferring a failed step', () => {
    expect(currentStep({ status: 'cancelled', progress })?.id).toBe('convert');
    const failed = [step('download', 'done'), step('convert', 'failed'), step('upload', 'running')];
    expect(currentStep({ status: 'failed', progress: failed })?.id).toBe('convert');
  });

  it('is nothing for pending or succeeded jobs', () => {
    expect(currentStep({ status: 'pending', progress })).toBeUndefined();
    expect(currentStep({ status: 'success', progress })).toBeUndefined();
  });
});

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

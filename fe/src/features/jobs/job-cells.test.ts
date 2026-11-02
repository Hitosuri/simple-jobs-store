import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { attemptsShown, ErrorLine, shownStepStatus } from './job-cells';

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

  it('marks a running step stopped once the job is no longer running', () => {
    for (const job of ['pending', 'success', 'failed', 'cancelled'] as const) {
      expect(shownStepStatus('running', job)).toBe('stopped');
    }
  });

  it('leaves every other step status as reported', () => {
    for (const step of ['pending', 'done', 'failed', 'skipped'] as const) {
      expect(shownStepStatus(step, 'failed')).toBe(step);
    }
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

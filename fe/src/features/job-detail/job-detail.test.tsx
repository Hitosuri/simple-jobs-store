import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { DetailBody } from './job-detail';

const useJob = vi.fn();
vi.mock('@/api/queries', () => ({
  useJob: (id: number) => useJob(id),
  useOverview: () => ({ data: undefined }),
  useWorkers: () => ({ data: undefined }),
}));
vi.mock('@/api/mutations', () => {
  const idle = () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() });
  return { useCancelJob: idle, useRetryJob: idle, useSetPriority: idle, useDeleteJob: idle };
});

const failedJob = {
  id: 8,
  type: 'EMAIL_BATCH',
  description: { src: 'a.bin' },
  maxRunMs: 60000,
  workerId: null,
  leaseUntil: null,
  deadlineAt: null,
  availableAt: '2026-11-02T09:00:00Z',
  priority: 0,
  status: 'failed',
  attempt: 3,
  maxAttempt: 3,
  error: "KeyError: 'recipient'",
  errorDetail: 'Traceback (most recent call last)',
  result: null,
  createdAt: '2026-11-02T09:00:00Z',
  updatedAt: '2026-11-02T09:00:05Z',
  startedAt: '2026-11-02T09:00:01Z',
  finishedAt: '2026-11-02T09:00:04Z',
  reports: null,
  reportStatus: null,
  reportRound: 0,
  reportCursor: 0,
  reportNextAt: null,
  reportError: null,
  progress: [{ id: 'download', status: 'running', current: 3, total: 10, percent: null, message: null }],
  requeuedAt: null,
  attemptsUsed: 3,
  lastWorkerId: 'batch-02',
};

const render = (jobId = '999999') => renderToString(<DetailBody jobId={jobId} onClose={() => {}} />);

describe('DetailBody', () => {
  it('renders "Job not found" with a Close action on JOB_NOT_FOUND', () => {
    useJob.mockReturnValue({
      data: undefined,
      isError: true,
      error: new ApiError('JOB_NOT_FOUND', 'no such job', 404),
    });
    const html = render();
    expect(html).toContain('Job not found');
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
  });

  it('renders "Job not found" for a non-numeric id without calling the API', () => {
    useJob.mockClear();
    const html = render('abc');
    expect(html).toContain('Job not found');
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
    expect(useJob).not.toHaveBeenCalled();
  });

  it('renders an in-block retry for other errors', () => {
    useJob.mockReturnValue({
      data: undefined,
      isError: true,
      error: new ApiError('INTERNAL_ERROR', 'boom', 500),
      dataUpdatedAt: 0,
      refetch: vi.fn(),
    });
    const html = render();
    expect(html).not.toContain('Job not found');
    expect(html).toContain('boom');
    expect(html).toContain('Retry');
  });

  describe('failed job', () => {
    const renderFailed = () => {
      useJob.mockReturnValue({ data: { job: failedJob, attempts: [] }, isError: false });
      return render('8');
    };

    it('leads the hero with the error message', () => {
      const html = renderFailed();
      const hero = html.indexOf('KeyError: &#x27;recipient&#x27;');
      expect(hero).toBeGreaterThan(-1);
      expect(hero).toBeLessThan(html.indexOf('ran for'));
    });

    it('opens the Error block above Progress', () => {
      const html = renderFailed();
      expect(html).toMatch(/<details[^>]*open[^>]*>\s*<summary[^>]*>Error/);
      expect(html.indexOf('>Error<')).toBeLessThan(html.indexOf('>Progress'));
    });

    it('shows a stale running step as stopped, not spinning', () => {
      const html = renderFailed();
      expect(html).not.toContain('animate-spin');
      expect(html).toContain('stopped');
    });

    it('makes Retry the primary action', () => {
      const html = renderFailed();
      expect(html).toMatch(/<button[^>]*bg-primary[^>]*>(?:(?!<\/button>).)*Retry<\/button>/s);
    });
  });
});

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
  return {
    useCancelJob: idle,
    useRetryJob: idle,
    useReplayJob: idle,
    useSendReport: idle,
    useSetPriority: idle,
    useDeleteJob: idle,
  };
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
  replay: null,
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
      expect(hero).toBeLessThan(html.indexOf('Ran for'));
    });

    it('opens the Error block above Progress', () => {
      const html = renderFailed();
      expect(html).toMatch(/aria-expanded="true"[^>]*>(?:(?!<\/button>).)*Error/s);
      expect(html).toContain('Traceback (most recent call last)');
      expect(html.indexOf('Traceback')).toBeLessThan(html.indexOf('>Progress'));
    });

    it('hides the callback card when the job has no callbacks', () => {
      expect(renderFailed()).not.toContain('Callback');
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

  describe('pending job retrying after a failed attempt', () => {
    const renderRetry = () => {
      const job = {
        ...failedJob,
        status: 'pending',
        attemptsUsed: 1,
        availableAt: new Date(Date.now() + 60_000).toISOString(),
        finishedAt: null,
        reports: [{ type: 'callback', config: { url: 'https://a.example/' } }],
      };
      const attempts = [
        {
          attemptNo: 1,
          workerId: 'batch-02',
          outcome: 'failed',
          error: "KeyError: 'recipient'",
          errorDetail: null,
          startedAt: '2026-11-02T09:00:01Z',
          endedAt: '2026-11-02T09:00:04Z',
        },
      ];
      useJob.mockReturnValue({ data: { job, attempts }, isError: false });
      return render('8');
    };

    it('leads with the failed attempt and when it retries', () => {
      const html = renderRetry();
      expect(html).toContain('Attempt 1 failed: KeyError: &#x27;recipient&#x27;');
      expect(html).toMatch(/Retrying at [A-Z][a-z]{2} \d+, [\d:]+ \(attempt 2 of 3\)/);
    });

    it('opens the Error block and marks old progress as the last attempt', () => {
      const html = renderRetry();
      expect(html).toMatch(/aria-expanded="true"[^>]*>(?:(?!<\/button>).)*Error/s);
      expect(html).toContain('Last attempt progress');
    });

    it('shows the callback waiting for the job to finish', () => {
      const html = renderRetry();
      expect(html).toContain('>Callback<');
      expect(html).toContain('Sent when the job finishes');
    });
  });

  describe('succeeded job', () => {
    const succeeded = {
      ...failedJob,
      status: 'success',
      error: null,
      errorDetail: null,
      result: { rows: 42 },
      progress: null,
    };
    const firstRun = {
      attemptNo: 1,
      workerId: 'batch-02',
      outcome: 'succeeded',
      error: null,
      errorDetail: null,
      startedAt: '2026-11-02T09:00:01Z',
      endedAt: '2026-11-02T09:00:04Z',
      replay: false,
    };

    it('makes Replay the primary action', () => {
      useJob.mockReturnValue({ data: { job: succeeded, attempts: [firstRun] }, isError: false });
      const html = render('8');
      expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Replay<\/button>/s);
    });

    it.each([
      ['failed', true],
      ['success', true],
      ['pending', false],
      ['reporting', false],
    ])('offers Send again on each callback url when the report is %s: %s', (reportStatus, offered) => {
      const job = {
        ...succeeded,
        reports: [
          { type: 'callback', config: { url: 'https://a.example/' } },
          { type: 'callback', config: { url: 'https://b.example/' } },
        ],
        reportStatus,
        reportNextAt: reportStatus === 'pending' || reportStatus === 'reporting' ? '2026-11-02T09:00:05Z' : null,
      };
      useJob.mockReturnValue({ data: { job, attempts: [firstRun] }, isError: false });
      const buttons = render('8').match(/<button[^>]*aria-label="Send again to https:\/\/[ab]\.example\/"/g) ?? [];
      expect(buttons).toHaveLength(offered ? 2 : 0);
    });

    it('shows the last manual send under its callback url', () => {
      const job = {
        ...succeeded,
        reports: [{ type: 'callback', config: { url: 'https://a.example/' } }],
        reportStatus: 'success',
        reportSends: [{ at: '2026-11-02T09:05:00Z', error: 'HTTP 500' }],
      };
      useJob.mockReturnValue({ data: { job, attempts: [firstRun] }, isError: false });
      expect(render('8')).toMatch(
        /text-muted-foreground[^>]*>Sent again [A-Z][a-z]{2} \d+, [\d:]+(?:<!-- -->)? · (?:<!-- -->)?<span class="text-bad">failed: HTTP 500</,
      );
    });

    it('while replaying, hides the old result and finish time and marks the job and the attempt', () => {
      const job = {
        ...succeeded,
        status: 'running',
        replay: { overwrite: false, reportSuccess: false, reportFailed: false },
        requeuedAt: '2026-11-02T10:00:00Z',
        startedAt: '2026-11-02T10:00:01Z',
      };
      const rerun = { ...firstRun, attemptNo: 2, outcome: null, endedAt: null, replay: true };
      useJob.mockReturnValue({ data: { job, attempts: [firstRun, rerun] }, isError: false });
      const html = render('8');
      expect(html).not.toContain('>Finished<');
      expect(html).not.toContain('>Result<');
      expect(html.match(/>Replay</g)).toHaveLength(2);
    });
  });
});

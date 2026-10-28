import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { DetailBody } from './job-detail';

const useJob = vi.fn();
vi.mock('@/api/queries', () => ({ useJob: (id: number) => useJob(id), useOverview: vi.fn(), useWorkers: vi.fn() }));

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
});

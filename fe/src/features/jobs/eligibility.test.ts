import { describe, expect, it } from 'vitest';
import type { JobStatus } from '@/api/types';
import { canCancel, canDelete, canRetry, canSetPriority, whyNot } from './eligibility';

const STATUSES: JobStatus[] = ['pending', 'running', 'success', 'failed', 'cancelled'];

describe('eligibility', () => {
  it.each([
    ['cancel', canCancel, ['pending', 'running']],
    ['retry', canRetry, ['failed', 'cancelled']],
    ['delete', canDelete, ['success', 'failed', 'cancelled']],
    ['priority', canSetPriority, ['pending']],
  ] as const)('%s allowed only for its statuses', (_, can, allowed) => {
    for (const s of STATUSES) expect(can(s)).toBe((allowed as readonly string[]).includes(s));
  });

  it('whyNot explains each action', () => {
    expect(whyNot('priority', 'running')).toBe('Only pending jobs can change priority');
    expect(whyNot('cancel', 'success')).toBe('Only pending or running jobs can be cancelled');
    expect(whyNot('retry', 'success')).toBe('Only failed or cancelled jobs can be retried');
    expect(whyNot('delete', 'running')).toBe('Only finished jobs can be deleted');
  });
});

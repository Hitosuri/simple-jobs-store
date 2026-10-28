import { describe, expect, it } from 'vitest';
import { bulkResultMessage } from './bulk-result';

describe('bulkResultMessage', () => {
  it('lists skipped count and code', () => {
    const skipped = [
      { id: 4, code: 'JOB_NOT_RETRYABLE' as const },
      { id: 5, code: 'JOB_NOT_RETRYABLE' as const },
    ];
    expect(bulkResultMessage('retry', { done: [1, 2, 3], skipped })).toBe('Retried 3, skipped 2 (JOB_NOT_RETRYABLE)');
  });

  it('joins several codes', () => {
    const skipped = [
      { id: 4, code: 'JOB_NOT_FOUND' as const },
      { id: 5, code: 'JOB_NOT_RETRYABLE' as const },
    ];
    expect(bulkResultMessage('retry', { done: [1], skipped })).toBe(
      'Retried 1, skipped 2 (JOB_NOT_FOUND, JOB_NOT_RETRYABLE)',
    );
  });

  it('omits skipped when none', () => {
    expect(bulkResultMessage('retry', { done: [1, 2, 3], skipped: [] })).toBe('Retried 3');
    expect(bulkResultMessage('delete', { done: [1], skipped: [] })).toBe('Deleted 1');
    expect(bulkResultMessage('cancel', { done: [1], skipped: [] })).toBe('Cancelled 1');
    expect(bulkResultMessage('priority', { done: [1], skipped: [] })).toBe('Updated 1');
  });
});

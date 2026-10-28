import type { BulkAction, JobStatus } from '@/api/types';

export const canCancel = (s: JobStatus) => s === 'pending' || s === 'running';
export const canRetry = (s: JobStatus) => s === 'failed' || s === 'cancelled';
export const canDelete = (s: JobStatus) => s === 'success' || s === 'failed' || s === 'cancelled';
export const canSetPriority = (s: JobStatus) => s === 'pending';

const RULES: Record<BulkAction, { can: (s: JobStatus) => boolean; why: string }> = {
  cancel: { can: canCancel, why: 'Only pending or running jobs can be cancelled' },
  retry: { can: canRetry, why: 'Only failed or cancelled jobs can be retried' },
  delete: { can: canDelete, why: 'Only finished jobs can be deleted' },
  priority: { can: canSetPriority, why: 'Only pending jobs can change priority' },
};

export const can = (action: BulkAction, s: JobStatus) => RULES[action].can(s);

export function whyNot(action: BulkAction, s: JobStatus): string {
  return can(action, s) ? '' : RULES[action].why;
}

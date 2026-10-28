import type { BulkAction, BulkResult } from '@/api/types';

const VERB: Record<BulkAction, string> = {
  cancel: 'Cancelled',
  retry: 'Retried',
  delete: 'Deleted',
  priority: 'Updated',
};

export function bulkResultMessage(action: BulkAction, { done, skipped }: BulkResult): string {
  const head = `${VERB[action]} ${done.length}`;
  if (!skipped.length) return head;
  const codes = [...new Set(skipped.map((s) => s.code))].join(', ');
  return `${head}, skipped ${skipped.length} (${codes})`;
}

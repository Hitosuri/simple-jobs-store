import type { Job, JobStatus } from '@/api/types';

/** Every type name from the given sources (queued, running, recent stats, selected), unique and sorted. */
export function knownTypes(...sources: (readonly string[] | undefined)[]): string[] {
  return [...new Set(sources.flatMap((s) => s ?? []))].sort();
}

/** Trigger text for the type filter: the first selected name, plus how many more. */
export function typeFilterLabel(selected: readonly string[]): string {
  if (selected.length === 0) return 'All types';
  return selected.length === 1 ? selected[0] : `${selected[0]} +${selected.length - 1}`;
}

/**
 * Page buttons for the pager: always the first and last page, the current one with its neighbours,
 * and `'gap'` for skipped runs. Past 7 pages it is always 7 slots, so the pager does not change width.
 */
export function pageItems(page: number, last: number): (number | 'gap')[] {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (last <= 7) return range(1, Math.max(last, 1));
  if (page <= 4) return [...range(1, 5), 'gap', last];
  if (page >= last - 3) return [1, 'gap', ...range(last - 4, last)];
  return [1, 'gap', page - 1, page, page + 1, 'gap', last];
}

/** Columns that only earn their space in some states: Status is redundant under a single-status tab. */
export function optionalColumns(jobs: Pick<Job, 'priority'>[], status: JobStatus[] | undefined) {
  return { status: status?.length !== 1, priority: jobs.some((j) => j.priority !== 0) };
}

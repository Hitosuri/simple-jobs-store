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

/** Page number typed into the pager, clamped to 1..last; null when the text is not a number. */
export function parsePage(text: string, last: number): number | null {
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), 1), Math.max(last, 1));
}

/** Columns that only earn their space in some states: Status is redundant under a single-status tab. */
export function optionalColumns(jobs: Pick<Job, 'priority'>[], status: JobStatus[] | undefined) {
  return { status: status?.length !== 1, priority: jobs.some((j) => j.priority !== 0) };
}

import type { Attempt } from '@/api/types';

export type TimelineItem =
  { kind: 'attempt'; attempt: Attempt; durationMs: number | null } | { kind: 'requeue'; at: string };

const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const formatDateTime = (iso: string) => dateTime.format(Date.parse(iso));

function durationOf(a: Attempt, now: number): number | null {
  const start = Date.parse(a.startedAt);
  if (a.endedAt) return Date.parse(a.endedAt) - start;
  return a.outcome === null ? now - start : null;
}

export function buildTimeline(attempts: Attempt[], requeuedAt: string | null, now: number): TimelineItem[] {
  const items: TimelineItem[] = [...attempts]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map((attempt) => ({ kind: 'attempt', attempt, durationMs: durationOf(attempt, now) }));
  if (requeuedAt) {
    const at = Date.parse(requeuedAt);
    const i = items.findIndex((it) => it.kind === 'attempt' && Date.parse(it.attempt.startedAt) <= at);
    items.splice(i === -1 ? items.length : i, 0, { kind: 'requeue', at: requeuedAt });
  }
  return items;
}

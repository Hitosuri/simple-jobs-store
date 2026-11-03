import type { Alert, Finished, TypeQueue } from '@/api/types';
import { formatDuration, formatNumber } from '@/lib/format';
import { pendingTone, type Tone } from './thresholds';

/** Below this many finished jobs a percent is noise, so the rate reads "8 of 9". */
export const SMALL_SAMPLE = 20;

/** Largest unit only: "7m", "2h", "45s". */
export function roughDuration(ms: number): string {
  return formatDuration(ms).split(' ')[0];
}

export function waitOf(queue: TypeQueue, now: number): number {
  return Math.max(now - Date.parse(queue.oldestAvailableAt), 0);
}

export function oldestWait(queues: TypeQueue[], now: number): number | null {
  return queues.length ? Math.max(...queues.map((q) => waitOf(q, now))) : null;
}

export interface Verdict {
  tone: Tone;
  text: string;
  detail?: string;
}

/** One phrase answering "is anything wrong?", the most severe issue first. */
export function fleetVerdict({
  lostWorkers,
  failed,
  busy,
  total,
  oldestWaitMs,
}: {
  lostWorkers: string[];
  failed: number;
  busy: number;
  total: number;
  oldestWaitMs: number | null;
}): Verdict {
  if (lostWorkers.length === 1) return { tone: 'bad', text: `${lostWorkers[0]} stopped responding` };
  if (lostWorkers.length > 1) return { tone: 'bad', text: `${lostWorkers.length} workers stopped responding` };
  if (failed > 0) return { tone: 'bad', text: `${formatNumber(failed)} ${failed === 1 ? 'job' : 'jobs'} failed` };
  if (busy >= total && oldestWaitMs !== null && pendingTone(oldestWaitMs) === 'warn') {
    return { tone: 'warn', text: 'Queue backing up', detail: `oldest waiting ${roughDuration(oldestWaitMs)}` };
  }
  return { tone: 'fg', text: 'All clear' };
}

/** Success rate as shown: whole percent rounded down (never "100%" with a failure), or "8 of 9" on a small sample. */
export function successShown({ success, failed }: Finished): { text: string; rate: number | null } {
  const total = success + failed;
  if (total === 0) return { text: '-', rate: null };
  if (total < SMALL_SAMPLE) return { text: `${success} of ${total}`, rate: success / total };
  const pct = Math.floor((success / total) * 100 + 1e-9);
  return { text: `${pct}%`, rate: pct / 100 };
}

export interface WorkerAlerts {
  workerId: string;
  lostAt: string | null;
  jobIds: number[];
  latestAt: string;
}

/** One entry per worker, lost workers first, then the most recent. */
export function groupAlerts(alerts: Alert[]): WorkerAlerts[] {
  const groups = new Map<string, WorkerAlerts>();
  for (const a of alerts) {
    const g = groups.get(a.workerId) ?? { workerId: a.workerId, lostAt: null, jobIds: [], latestAt: a.at };
    if (a.kind === 'worker_lost') g.lostAt = a.at;
    if (a.jobId !== null && !g.jobIds.includes(a.jobId)) g.jobIds.push(a.jobId);
    if (Date.parse(a.at) > Date.parse(g.latestAt)) g.latestAt = a.at;
    groups.set(a.workerId, g);
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.lostAt !== null) - Number(a.lostAt !== null) || Date.parse(b.latestAt) - Date.parse(a.latestAt),
  );
}

const MAX_IDS = 3;

function jobList(ids: number[]): string {
  if (ids.length > MAX_IDS) return `${ids.length} jobs`;
  const tags = ids.map((id) => `#${id}`);
  const list = tags.length === 1 ? tags[0] : `${tags.slice(0, -1).join(', ')} and ${tags.at(-1)}`;
  return `${ids.length === 1 ? 'job' : 'jobs'} ${list}`;
}

/**
 * Plain sentence for one worker's alerts; `when` is like "7m ago". It does not say what happened to
 * the jobs: the alert cannot tell a requeue from a final failure (no attempts left).
 */
export function alertText(group: WorkerAlerts, name: string, when?: string): string {
  const at = when ? ` ${when}` : '';
  const { jobIds } = group;
  if (group.lostAt !== null) {
    return jobIds.length === 0
      ? `${name} stopped responding${at}`
      : `${name} stopped responding${at} while running ${jobList(jobIds)}`;
  }
  return `${name} timed out on ${jobList(jobIds)}${at}`;
}

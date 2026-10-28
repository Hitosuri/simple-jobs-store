import { z } from 'zod';
import type { AttemptRow, Worker } from '@/api/types';

export const RANGES = { '15m': 900_000, '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000 } as const;

export const MACHINES_DEFAULTS = { range: '1h', offline: false } as const;

export const machinesSearchSchema = z.object({
  range: z.enum(['15m', '1h', '6h', '24h']).catch(MACHINES_DEFAULTS.range),
  offline: z.boolean().catch(MACHINES_DEFAULTS.offline),
});

export type MachinesUrlSearch = z.output<typeof machinesSearchSchema>;

export interface LaneBar {
  jobId: number;
  attemptNo: number;
  type: string;
  leftPct: number;
  widthPct: number;
  failed: boolean;
}

export function layoutLanes(attempts: AttemptRow[], from: number, to: number): Map<string, LaneBar[]> {
  const span = to - from;
  const lanes = new Map<string, LaneBar[]>();
  for (const a of attempts) {
    const start = Math.max(Date.parse(a.startedAt), from);
    const end = Math.min(a.endedAt ? Date.parse(a.endedAt) : to, to);
    if (end < start) continue;
    const bar: LaneBar = {
      jobId: a.jobId,
      attemptNo: a.attemptNo,
      type: a.jobType,
      leftPct: ((start - from) / span) * 100,
      widthPct: ((end - start) / span) * 100,
      failed: a.outcome !== null && a.outcome !== 'succeeded',
    };
    lanes.set(a.workerId, [...(lanes.get(a.workerId) ?? []), bar]);
  }
  return lanes;
}

export function summarizeAttempts(attempts: AttemptRow[]): {
  done: number;
  successRate: number | null;
  meanRunMs: number | null;
} {
  const ended = attempts.filter((a) => a.endedAt !== null);
  if (ended.length === 0) return { done: 0, successRate: null, meanRunMs: null };
  const succeeded = ended.filter((a) => a.outcome === 'succeeded').length;
  const runMs = ended.reduce((sum, a) => sum + (Date.parse(a.endedAt!) - Date.parse(a.startedAt)), 0);
  return { done: ended.length, successRate: succeeded / ended.length, meanRunMs: runMs / ended.length };
}

export function groupByMachine(workers: Worker[]): { ip: string; workers: Worker[] }[] {
  const groups = new Map<string, Worker[]>();
  for (const w of workers) groups.set(w.ip, [...(groups.get(w.ip) ?? []), w]);
  return [...groups]
    .map(([ip, ws]) => ({ ip, workers: ws }))
    .sort((a, b) => a.ip.localeCompare(b.ip, 'en', { numeric: true }));
}

import type { Worker } from '@/api/types';

/**
 * Display label per worker id, unique within `workers`: the name, plus the ip when the name
 * repeats across machines, or the shortest distinct id prefix (8+ chars) when it repeats on one machine.
 */
export function workerLabels(workers: Pick<Worker, 'id' | 'name' | 'ip'>[]): Map<string, string> {
  return new Map(
    workers.map((w) => {
      const same = workers.filter((s) => s.name === w.name);
      if (same.length === 1) return [w.id, w.name];
      if (new Set(same.map((s) => s.ip)).size === same.length) return [w.id, `${w.name} · ${w.ip}`];
      let n = 8;
      while (new Set(same.map((s) => s.id.slice(0, n))).size < same.length) n++;
      return [w.id, `${w.name} · ${w.id.slice(0, n)}`];
    }),
  );
}

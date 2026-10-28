import { z } from 'zod';
import type { JobsSearch } from '@/api/types';

const STATUS = z.enum(['pending', 'running', 'success', 'failed', 'cancelled']);
const text = z.union([z.string(), z.number().transform(String)]);
const oneOrMany = <T extends z.ZodType>(item: T) =>
  z.union([z.array(item), item.transform((v) => [v] as z.output<T>[])]).optional();

export const CREATED_WINDOWS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 } as const;

export const JOBS_DEFAULTS = { created: 'all', sort: 'newest', page: 1, pageSize: 50 } as const;

export const jobsSearchSchema = z.object({
  status: oneOrMany(STATUS).catch(undefined),
  type: oneOrMany(text).catch(undefined),
  worker: text.optional().catch(undefined),
  q: text.optional().catch(undefined),
  created: z.enum(['1h', '24h', '7d', 'all']).catch(JOBS_DEFAULTS.created),
  sort: z.enum(['newest', 'oldest', 'priority', 'running_longest']).catch(JOBS_DEFAULTS.sort),
  page: z.number().int().min(1).catch(JOBS_DEFAULTS.page),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).catch(JOBS_DEFAULTS.pageSize),
});

export type JobsUrlSearch = z.output<typeof jobsSearchSchema>;

export function toJobsSearch({ created, ...rest }: JobsUrlSearch, now: number): JobsSearch {
  return {
    ...rest,
    createdFrom: created === 'all' ? undefined : new Date(now - CREATED_WINDOWS[created]).toISOString(),
  };
}

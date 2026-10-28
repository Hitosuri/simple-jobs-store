import { describe, expect, it } from 'vitest';
import { jobsSearchSchema, toJobsSearch } from './search';

const defaults = { created: 'all', sort: 'newest', page: 1, pageSize: 50 };

describe('jobsSearchSchema', () => {
  it('degrades bad input to defaults', () => {
    expect(jobsSearchSchema.parse({ page: '-3', status: 'foo', sort: 'x' })).toEqual(defaults);
    expect(jobsSearchSchema.parse({})).toEqual(defaults);
    expect(jobsSearchSchema.parse({ page: 0, pageSize: 7, created: '2d' })).toEqual(defaults);
  });

  it('accepts a single value or an array, drops invalid statuses', () => {
    expect(jobsSearchSchema.parse({ status: 'failed' }).status).toEqual(['failed']);
    expect(jobsSearchSchema.parse({ status: ['failed', 'nope'] }).status).toBeUndefined();
    expect(jobsSearchSchema.parse({ type: 'a', worker: 12, q: 345 })).toMatchObject({
      type: ['a'],
      worker: '12',
      q: '345',
    });
  });
});

describe('toJobsSearch', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const base = jobsSearchSchema.parse({});

  it('maps created windows to createdFrom', () => {
    expect(toJobsSearch({ ...base, created: '1h' }, now).createdFrom).toBe('2026-10-28T11:00:00.000Z');
    expect(toJobsSearch({ ...base, created: '24h' }, now).createdFrom).toBe('2026-10-27T12:00:00.000Z');
    expect(toJobsSearch({ ...base, created: '7d' }, now).createdFrom).toBe('2026-10-21T12:00:00.000Z');
    expect(toJobsSearch(base, now).createdFrom).toBeUndefined();
  });

  it('passes filters through', () => {
    const out = toJobsSearch({ ...base, status: ['failed'], type: ['a'], worker: 'w', q: 'x', page: 2 }, now);
    expect(out).toEqual({
      status: ['failed'],
      type: ['a'],
      worker: 'w',
      q: 'x',
      sort: 'newest',
      page: 2,
      pageSize: 50,
    });
  });
});

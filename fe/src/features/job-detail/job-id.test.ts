import { describe, expect, it } from 'vitest';
import { neighbors, parseJobId } from './job-id';

describe('neighbors', () => {
  const ids = [30, 20, 10];
  it('steps through the list in display order', () => {
    expect(neighbors(ids, 20)).toEqual({ prev: 30, next: 10 });
  });
  it('has no prev at the top and no next at the bottom', () => {
    expect(neighbors(ids, 30)).toEqual({ prev: undefined, next: 20 });
    expect(neighbors(ids, 10)).toEqual({ prev: 20, next: undefined });
  });
  it('has neither when the job is not in the list', () => {
    expect(neighbors(ids, 99)).toEqual({});
    expect(neighbors(ids, null)).toEqual({});
  });
});

describe('parseJobId', () => {
  it('accepts positive integers', () => {
    expect(parseJobId('1')).toBe(1);
    expect(parseJobId('999999')).toBe(999999);
  });

  it.each(['abc', '', '0', '-3', '1.5', '1e3', ' 7', '0x10', '99999999999999999999'])('rejects %j', (raw) => {
    expect(parseJobId(raw)).toBeNull();
  });
});

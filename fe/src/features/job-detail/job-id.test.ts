import { describe, expect, it } from 'vitest';
import { parseJobId } from './job-id';

describe('parseJobId', () => {
  it('accepts positive integers', () => {
    expect(parseJobId('1')).toBe(1);
    expect(parseJobId('999999')).toBe(999999);
  });

  it.each(['abc', '', '0', '-3', '1.5', '1e3', ' 7', '0x10', '99999999999999999999'])('rejects %j', (raw) => {
    expect(parseJobId(raw)).toBeNull();
  });
});

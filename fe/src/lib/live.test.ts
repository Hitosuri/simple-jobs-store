import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { isConnectionFailure } from './live';

describe('isConnectionFailure', () => {
  it.each([
    [new ApiError('NETWORK', 'x', 0), true],
    [new ApiError('INTERNAL_ERROR', 'x', 500), true],
    [new ApiError('JOB_NOT_FOUND', 'x', 404), false],
    [new ApiError('VALIDATION_ERROR', 'x', 422), false],
    [new TypeError('x'), false],
    [null, false],
  ])('%s -> %s', (err, expected) => {
    expect(isConnectionFailure(err)).toBe(expected);
  });
});

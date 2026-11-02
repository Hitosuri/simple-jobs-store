import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { isConnectionFailure, watchLiveStatus } from './live';

describe('watchLiveStatus', () => {
  it('never reports synchronously from a cache event, which useQuery fires during render', () => {
    const client = new QueryClient();
    const onChange = vi.fn();
    const stop = watchLiveStatus(client.getQueryCache(), onChange);
    onChange.mockClear();
    client.getQueryCache().build(client, { queryKey: ['job', 1] });
    client.setQueryData(['job', 1], { id: 1 });
    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('reports once after a burst of cache events', async () => {
    const client = new QueryClient();
    const onChange = vi.fn();
    const stop = watchLiveStatus(client.getQueryCache(), onChange);
    onChange.mockClear();
    client.setQueryData(['job', 1], { id: 1 });
    client.setQueryData(['job', 2], { id: 2 });
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops reporting once unsubscribed', async () => {
    const client = new QueryClient();
    const onChange = vi.fn();
    const stop = watchLiveStatus(client.getQueryCache(), onChange);
    onChange.mockClear();
    client.setQueryData(['job', 1], { id: 1 });
    stop();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });
});

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

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

export interface LiveStatus {
  state: 'live' | 'stale';
  lastSuccessAt: number | null;
}

export function isConnectionFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NETWORK' || error.status >= 500);
}

export function useLiveStatus(): LiveStatus {
  const cache = useQueryClient().getQueryCache();
  const [status, setStatus] = useState<LiveStatus>({ state: 'live', lastSuccessAt: null });

  useEffect(() => {
    const read = () => {
      const active = cache.getAll().filter((q) => q.getObserversCount() > 0);
      const touched = (q: (typeof active)[number]) => Math.max(q.state.dataUpdatedAt, q.state.errorUpdatedAt);
      const latest = active.reduce<(typeof active)[number] | undefined>(
        (a, q) => (!a || touched(q) > touched(a) ? q : a),
        undefined,
      );
      const lastSuccessAt = Math.max(0, ...active.map((q) => q.state.dataUpdatedAt)) || null;
      const state =
        latest && latest.state.fetchFailureCount > 0 && isConnectionFailure(latest.state.error) ? 'stale' : 'live';
      setStatus((prev) =>
        prev.state === state && prev.lastSuccessAt === lastSuccessAt ? prev : { state, lastSuccessAt },
      );
    };
    read();
    return cache.subscribe(read);
  }, [cache]);

  return status;
}

import { useEffect, useState } from 'react';
import { useQueryClient, type QueryCache } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

export interface LiveStatus {
  state: 'live' | 'stale';
  lastSuccessAt: number | null;
}

export function isConnectionFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NETWORK' || error.status >= 500);
}

/** Calls `onChange` with the current status now, then once per microtask after cache events; returns unsubscribe. */
export function watchLiveStatus(cache: QueryCache, onChange: (status: LiveStatus) => void): () => void {
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
    onChange({ state, lastSuccessAt });
  };
  read();
  // useQuery fires cache events ('added', 'observerResultsUpdated') synchronously while its
  // component renders, so reacting inline would set state in another component mid-render.
  let queued = false;
  let stopped = false;
  const unsubscribe = cache.subscribe(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!stopped) read();
    });
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}

export function useLiveStatus(): LiveStatus {
  const cache = useQueryClient().getQueryCache();
  const [status, setStatus] = useState<LiveStatus>({ state: 'live', lastSuccessAt: null });

  useEffect(
    () =>
      watchLiveStatus(cache, (next) =>
        setStatus((prev) => (prev.state === next.state && prev.lastSuccessAt === next.lastSuccessAt ? prev : next)),
      ),
    [cache],
  );

  return status;
}

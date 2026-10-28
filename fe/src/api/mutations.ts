import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './client';
import type { BulkAction, BulkResult, Job } from './types';

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function useJobMutation<V, R>(fn: (vars: V) => Promise<R>, idOf?: (vars: V) => number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_data, vars) => {
      const keys: unknown[][] = [['jobs'], ['overview'], ['workers']];
      if (idOf) keys.push(['job', idOf(vars)]);
      else keys.push(['job']);
      return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
    onError: (err) => toast.error(err.message),
  });
}

export const useCancelJob = () =>
  useJobMutation(
    (id: number) => api<Job>(`/jobs/${id}/cancel`, { method: 'POST' }),
    (id) => id,
  );

export const useRetryJob = () =>
  useJobMutation(
    (id: number) => api<Job>(`/jobs/${id}/retry`, { method: 'POST' }),
    (id) => id,
  );

export const useSetPriority = () =>
  useJobMutation(
    ({ id, priority }: { id: number; priority: number }) =>
      api<Job>(`/jobs/${id}`, { ...post({ priority }), method: 'PATCH' }),
    ({ id }) => id,
  );

export const useDeleteJob = () =>
  useJobMutation(
    (id: number) => api<null>(`/jobs/${id}`, { method: 'DELETE' }),
    (id) => id,
  );

export const useBulk = () =>
  useJobMutation(({ action, ids, priority }: { action: BulkAction; ids: number[]; priority?: number }) =>
    api<BulkResult>('/jobs/bulk', post({ action, ids, priority })),
  );

export function useForgetWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/workers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
    onError: (err) => toast.error(err.message),
  });
}

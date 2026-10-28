import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import type {
  AttemptRow,
  JobCounts,
  JobDetail,
  JobsSearch,
  Overview,
  Page,
  Job,
  Stats,
  StatsRange,
  Worker,
} from './types';

const POLL_MS = 3_000;
const STATS_POLL_MS = 15_000;

function toQuery(params: Record<string, string | number | boolean | (string | number)[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, String(v));
  }
  const text = qs.toString();
  return text ? `?${text}` : '';
}

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/overview'),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useJobs(search: JobsSearch) {
  return useQuery({
    queryKey: ['jobs', 'list', search],
    queryFn: () => api<Page<Job>>(`/jobs${toQuery({ ...search })}`),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useJobCounts(search: JobsSearch) {
  const { type, worker, q, createdFrom, createdTo } = search;
  const filters = { type, worker, q, createdFrom, createdTo };
  return useQuery({
    queryKey: ['jobs', 'counts', filters],
    queryFn: () => api<JobCounts>(`/jobs/counts${toQuery({ ...filters })}`),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useJob(id: number) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => api<JobDetail>(`/jobs/${id}`),
    refetchInterval: POLL_MS,
  });
}

export function useWorkers(includeOffline: boolean) {
  return useQuery({
    queryKey: ['workers', includeOffline],
    queryFn: () => api<Worker[]>(`/workers${toQuery({ includeOffline })}`),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useAttempts(from: string, to: string, worker?: string) {
  return useQuery({
    queryKey: ['attempts', from, to, worker],
    queryFn: () => api<AttemptRow[]>(`/attempts${toQuery({ from, to, worker })}`),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useStats(range: StatsRange) {
  return useQuery({
    queryKey: ['stats', range],
    queryFn: () => api<Stats>(`/stats${toQuery({ range })}`),
    refetchInterval: STATS_POLL_MS,
    placeholderData: keepPreviousData,
  });
}

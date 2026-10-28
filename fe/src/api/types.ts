export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
export type AttemptOutcome = 'succeeded' | 'failed' | 'lease_expired' | 'deadline_exceeded' | 'released' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type ReportStatus = 'pending' | 'reporting' | 'success' | 'failed';
export type StatsRange = '1h' | '24h' | '7d';
export type JobSort = 'newest' | 'oldest' | 'priority' | 'running_longest';
export type BulkAction = 'cancel' | 'retry' | 'delete' | 'priority';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'ROUTE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'WORKER_NOT_FOUND'
  | 'WORKER_LEASE_EXPIRED'
  | 'JOB_NOT_FOUND'
  | 'LEASE_REJECTED'
  | 'JOB_ALREADY_FINISHED'
  | 'JOB_NOT_RETRYABLE'
  | 'JOB_NOT_PENDING'
  | 'JOB_NOT_FINISHED'
  | 'WORKER_CONNECTED'
  | 'WORKER_BUSY'
  | 'INTERNAL_ERROR';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface JobsSearch {
  status?: JobStatus[];
  type?: string[];
  worker?: string;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: JobSort;
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Worker {
  id: string;
  name: string;
  ip: string;
  concurrentLimit: number;
  connectedAt: string;
  lastSeenAt: string;
  leaseUntil: string;
  leaseMsRemaining: number;
  connected: boolean;
}

export interface ProgressStep {
  id: string;
  status: StepStatus;
  current: number | null;
  total: number | null;
  percent: number | null;
  message: string | null;
}

export interface ReportMethod {
  type: 'callback';
  config: { url: string };
}

export interface Job {
  id: number;
  type: string;
  description: Json;
  maxRunMs: number;
  workerId: string | null;
  leaseUntil: string | null;
  deadlineAt: string | null;
  availableAt: string;
  priority: number;
  status: JobStatus;
  attempt: number;
  maxAttempt: number;
  error: string | null;
  errorDetail: string | null;
  result: Json;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  reports: ReportMethod[] | null;
  reportStatus: ReportStatus | null;
  reportRound: number;
  reportCursor: number;
  reportNextAt: string | null;
  reportError: string | null;
  progress: ProgressStep[] | null;
  requeuedAt: string | null;
  attemptsUsed: number;
  lastWorkerId: string | null;
}

export interface Attempt {
  attemptNo: number;
  workerId: string;
  outcome: AttemptOutcome | null;
  error: string | null;
  errorDetail: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface JobDetail {
  job: Job;
  attempts: Attempt[];
}

export interface JobCounts {
  pending: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
}

export interface BulkResult {
  done: number[];
  skipped: { id: number; code: ErrorCode }[];
}

export interface AttemptRow {
  jobId: number;
  jobType: string;
  attemptNo: number;
  workerId: string;
  outcome: AttemptOutcome | null;
  startedAt: string;
  endedAt: string | null;
}

export interface RunningJob {
  id: number;
  type: string;
  startedAt: string;
  leaseUntil: string;
  progressPercent: number | null;
}

export interface WorkerLoad {
  worker: Worker;
  running: RunningJob[];
}

export interface TypeQueue {
  type: string;
  pending: number;
  oldestAvailableAt: string;
}

export interface Finished {
  success: number;
  failed: number;
}

export interface ThroughputBucket extends Finished {
  start: string;
}

export interface Alert {
  kind: 'worker_lost' | 'attempt_expired';
  workerId: string;
  jobId: number | null;
  at: string;
}

export interface Overview {
  counts: JobCounts;
  workers: WorkerLoad[];
  pendingByType: TypeQueue[];
  finished24h: Finished;
  finishedPrev24h: Finished;
  throughput: ThroughputBucket[];
  alerts: Alert[];
  runP95ByType: Record<string, number>;
}

export interface Kpi<T> {
  value: T | null;
  previous: T | null;
}

export interface StatsBucket {
  start: string;
  success: number;
  failed: number;
  cancelled: number;
}

export interface TypeStats {
  type: string;
  finished: number;
  successRate: number | null;
  runP50Ms: number | null;
  runP95Ms: number | null;
  waitP95Ms: number | null;
  pendingNow: number;
}

export interface ErrorCount {
  error: string;
  type: string;
  count: number;
}

export interface Stats {
  kpis: {
    finished: Kpi<number>;
    successRate: Kpi<number>;
    waitP95Ms: Kpi<number>;
    utilisation: Kpi<number>;
  };
  buckets: StatsBucket[];
  byType: TypeStats[];
  topErrors: ErrorCount[];
}

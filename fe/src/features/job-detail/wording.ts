import type { Attempt, Job } from '@/api/types';
import { statusLabel } from '@/components/status-badge';
import { formatClock, formatDuration } from '@/lib/format';

/** The store stores an expired lease or deadline as the job's error; show it as its label. */
export function errorText(error: string): string {
  return error === 'lease_expired' || error === 'deadline_exceeded' ? statusLabel(error) : error;
}

/** The big hero figure: how long the job ran, is running, or has been waiting. */
export function heroElapsed(
  job: Pick<Job, 'status' | 'startedAt' | 'finishedAt' | 'availableAt'>,
  now: number,
): { ms: number | null; label: string } {
  if (job.status === 'running' && job.startedAt) return { ms: now - Date.parse(job.startedAt), label: 'Running for' };
  if (job.status === 'pending') {
    const ready = Date.parse(job.availableAt);
    return ready > now ? { ms: ready - now, label: 'Ready in' } : { ms: now - ready, label: 'Waiting for' };
  }
  if (job.startedAt && job.finishedAt) {
    return { ms: Date.parse(job.finishedAt) - Date.parse(job.startedAt), label: 'Ran for' };
  }
  return { ms: null, label: 'Never started' };
}

/** For a pending job whose last attempt did not succeed: what went wrong and when it runs again. */
export function retryNote(
  job: Pick<Job, 'status' | 'attemptsUsed' | 'maxAttempt' | 'availableAt' | 'error'>,
  attempts: Attempt[],
  now: number,
): { lead: string; next: string } | null {
  if (job.status !== 'pending' || job.attemptsUsed === 0) return null;
  const last = attempts.reduce<Attempt | null>((a, b) => (a && a.attemptNo > b.attemptNo ? a : b), null);
  if (!last?.outcome || last.outcome === 'succeeded') return null;
  const error = last.error ?? job.error;
  const lead =
    last.outcome === 'failed'
      ? `Attempt ${last.attemptNo} failed${error ? `: ${errorText(error)}` : ''}`
      : `Attempt ${last.attemptNo}: ${statusLabel(last.outcome)}`;
  const which = `(attempt ${job.attemptsUsed + 1} of ${job.maxAttempt})`;
  const ready = Date.parse(job.availableAt);
  const next =
    ready > now ? `Retrying at ${formatClock(job.availableAt)} ${which}` : `Retrying when a worker is free ${which}`;
  return { lead, next };
}

type Tone = 'ok' | 'bad' | 'run' | 'fg' | 'muted';

export interface ReportLine {
  url: string;
  text: string;
  tone: Tone;
  /** The operator's last manual send to this target; it does not change `text`. */
  sent: { at: string; outcome: string; tone: 'ok' | 'bad' } | null;
}

const times = (n: number) => (n === 1 ? 'once' : `${n} times`);
const tries = (n: number) => (n === 1 ? '1 try' : `${n} tries`);

/**
 * One plain status per callback target. The store keeps a single status for the whole list:
 * `reportCursor` is the target being tried, earlier targets failed in this round, and `reportRound`
 * counts full passes over the list that failed. Manual sends are kept per target in `reportSends`.
 */
export function reportLines(
  job: Pick<Job, 'reports' | 'reportStatus' | 'reportRound' | 'reportCursor' | 'reportNextAt' | 'reportSends'>,
  now: number,
): ReportLine[] {
  const { reportStatus: status, reportRound: round, reportCursor: cursor } = job;
  const automatic = (i: number): { text: string; tone: Tone } => {
    const failedTries = round + (i < cursor ? 1 : 0);
    if (status === null) return { text: 'Sent when the job finishes', tone: 'muted' };
    if (status === 'failed') return { text: `Gave up after ${tries(failedTries)}`, tone: 'bad' };
    if (i !== cursor) {
      if (failedTries > 0) return { text: `Failed ${times(failedTries)}`, tone: 'muted' };
      return { text: status === 'success' ? 'Not needed' : 'Not tried yet', tone: 'muted' };
    }
    if (status === 'success') return { text: 'Delivered', tone: 'ok' };
    if (status === 'reporting') return { text: 'Sending now', tone: 'run' };
    const at = job.reportNextAt;
    if (!at || Date.parse(at) <= now) {
      return { text: failedTries === 0 ? 'Sending soon' : `Retrying soon (attempt ${failedTries + 1})`, tone: 'fg' };
    }
    const clock = formatClock(at);
    return {
      text:
        failedTries === 0 ? `Waiting to send at ${clock}` : `Waiting to retry at ${clock} (attempt ${failedTries + 1})`,
      tone: 'fg',
    };
  };
  return (job.reports ?? []).map(({ config: { url } }, i): ReportLine => {
    const send = job.reportSends?.[i] ?? null;
    return {
      url,
      ...automatic(i),
      sent: send && {
        at: `Sent again ${formatClock(send.at)}`,
        outcome: send.error === null ? 'delivered' : `failed: ${send.error}`,
        tone: send.error === null ? 'ok' : 'bad',
      },
    };
  });
}

/** "queued for 2m" style suffix; null when the span is unknown, negative or under a second. */
export function spanText(label: string, from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return ms >= 1000 ? `${label} ${formatDuration(ms)}` : null;
}

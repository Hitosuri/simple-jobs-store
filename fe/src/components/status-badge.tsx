import { Ban, CircleCheck, CircleX, Clock, LoaderCircle, Repeat, TimerOff, Undo2, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AttemptOutcome, JobStatus } from '@/api/types';

type Variant = 'neutral' | 'ok' | 'bad' | 'warn' | 'run';

const LOOK: Record<JobStatus | AttemptOutcome, { variant: Variant; Icon: LucideIcon; label: string }> = {
  pending: { variant: 'neutral', Icon: Clock, label: 'Pending' },
  running: { variant: 'run', Icon: LoaderCircle, label: 'Running' },
  success: { variant: 'ok', Icon: CircleCheck, label: 'Succeeded' },
  succeeded: { variant: 'ok', Icon: CircleCheck, label: 'Succeeded' },
  failed: { variant: 'bad', Icon: CircleX, label: 'Failed' },
  cancelled: { variant: 'neutral', Icon: Ban, label: 'Cancelled' },
  lease_expired: { variant: 'warn', Icon: TimerOff, label: 'Lease expired' },
  deadline_exceeded: { variant: 'warn', Icon: TimerOff, label: 'Deadline exceeded' },
  released: { variant: 'neutral', Icon: Undo2, label: 'Released' },
};

export function statusLabel(status: JobStatus | AttemptOutcome): string {
  return LOOK[status].label;
}

/** Label for text that may be a raw status or outcome (the store reports `lease_expired` as an error). */
export function labelIfStatus(text: string): string {
  return Object.hasOwn(LOOK, text) ? LOOK[text as JobStatus | AttemptOutcome].label : text;
}

/** Marks a job or attempt started by an operator replay. */
export function ReplayBadge() {
  return (
    <Badge variant="outline">
      <Repeat aria-hidden />
      Replay
    </Badge>
  );
}

export function StatusBadge({ status }: { status: JobStatus | AttemptOutcome }) {
  const { variant, Icon, label } = LOOK[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

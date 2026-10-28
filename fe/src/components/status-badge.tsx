import { Ban, CircleCheck, CircleX, Clock, LoaderCircle, TimerOff, Undo2, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AttemptOutcome, JobStatus } from '@/api/types';

type Variant = 'neutral' | 'ok' | 'bad' | 'warn' | 'run';

const LOOK: Record<JobStatus | AttemptOutcome, { variant: Variant; Icon: LucideIcon }> = {
  pending: { variant: 'neutral', Icon: Clock },
  running: { variant: 'run', Icon: LoaderCircle },
  success: { variant: 'ok', Icon: CircleCheck },
  succeeded: { variant: 'ok', Icon: CircleCheck },
  failed: { variant: 'bad', Icon: CircleX },
  cancelled: { variant: 'neutral', Icon: Ban },
  lease_expired: { variant: 'warn', Icon: TimerOff },
  deadline_exceeded: { variant: 'warn', Icon: TimerOff },
  released: { variant: 'neutral', Icon: Undo2 },
};

export function StatusBadge({ status }: { status: JobStatus | AttemptOutcome }) {
  const { variant, Icon } = LOOK[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {status}
    </Badge>
  );
}

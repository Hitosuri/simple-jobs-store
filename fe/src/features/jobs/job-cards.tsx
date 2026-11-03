import { useNavigate } from '@tanstack/react-router';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { JobActions } from './job-actions';
import {
  attemptsShown,
  Duration,
  ErrorLine,
  jobDuration,
  OpenLink,
  Progress,
  Started,
  TypeChip,
  workerOf,
  type ListProps,
} from './job-cells';

export function JobCards({
  jobs,
  now,
  p95,
  workers,
  selected,
  openId,
  onToggle,
  selectMode,
}: ListProps & { selectMode: boolean }) {
  const navigate = useNavigate();
  return (
    <ul className="flex flex-col gap-2">
      {jobs.map((job) => {
        const worker = workerOf(job, workers);
        const isSelected = selected.has(job.id);
        const tries = attemptsShown(job);
        const extra = [
          worker && [worker.name, worker.ip].filter(Boolean).join(' · '),
          (tries > 1 || job.status === 'failed') && `attempt ${tries}/${job.maxAttempt}`,
          job.priority !== 0 && `priority ${job.priority}`,
        ]
          .filter(Boolean)
          .join(' · ');
        const open = () => navigate({ to: '/jobs/$jobId', params: { jobId: String(job.id) }, search: (p) => p });
        return (
          <li
            key={job.id}
            onClick={selectMode ? () => onToggle(job.id) : open}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10',
              isSelected && 'bg-primary/[0.07] ring-primary/40',
              job.id === openId && 'bg-primary/[0.16]',
            )}
          >
            <Checkbox
              aria-label={`Select job ${job.id}`}
              checked={isSelected}
              onCheckedChange={() => onToggle(job.id)}
              onClick={(e) => e.stopPropagation()}
              className={cn('mt-3.5', !selectMode && 'max-md:hidden')}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <OpenLink id={job.id} className="inline-flex min-h-11 items-center font-medium" />
                  <TypeChip type={job.type} />
                </span>
                <StatusBadge status={job.status} />
              </div>
              <ErrorLine job={job} />
              <Progress job={job} />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">
                    <Started job={job} now={now} labelled />
                  </span>
                  {jobDuration(job, now) && (
                    <span className="truncate">
                      <Duration job={job} now={now} p95={p95} labelled />
                    </span>
                  )}
                  {extra && <span className="truncate">{extra}</span>}
                </div>
                <JobActions job={job} variant="row" />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

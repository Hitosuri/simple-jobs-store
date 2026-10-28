import { useNavigate } from '@tanstack/react-router';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Elapsed, OpenLink, Progress, TypeChip, workerOf, type ListProps } from './job-cells';

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
            {selectMode && (
              <Checkbox
                aria-label={`Select job ${job.id}`}
                checked={isSelected}
                onCheckedChange={() => onToggle(job.id)}
                className="mt-1"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <OpenLink id={job.id} className="inline-flex min-h-11 items-center font-medium" />
                  <TypeChip type={job.type} />
                </span>
                <StatusBadge status={job.status} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{worker ? `${worker.name}${worker.ip ? ` · ${worker.ip}` : ''}` : '-'}</span>
                <span className="shrink-0 text-foreground">
                  <Elapsed job={job} now={now} p95={p95} />
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                <span>
                  attempt {job.attempt}/{job.maxAttempt} · priority {job.priority}
                </span>
                <Progress job={job} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

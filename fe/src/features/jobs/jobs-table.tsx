import { useNavigate } from '@tanstack/react-router';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { attemptsShown, DASH, Elapsed, OpenLink, Progress, TypeChip, workerOf, type ListProps } from './job-cells';

const LG = 'hidden lg:table-cell';
const HEAD = 'sticky top-0 z-10 bg-card text-xs text-muted-foreground';

export function JobsTable({
  jobs,
  now,
  p95,
  workers,
  selected,
  openId,
  onToggle,
  onToggleAll,
}: ListProps & { onToggleAll: () => void }) {
  const navigate = useNavigate();
  const allOn = jobs.length > 0 && jobs.every((j) => selected.has(j.id));
  const someOn = !allOn && jobs.some((j) => selected.has(j.id));

  return (
    <div className="max-h-[calc(100vh-16rem)] overflow-auto">
      <table className="w-full text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, 'w-10 pl-3')}>
              <Checkbox
                aria-label="Select all on page"
                checked={allOn}
                indeterminate={someOn}
                onCheckedChange={onToggleAll}
              />
            </TableHead>
            <TableHead className={cn(HEAD, LG, 'text-right')}>ID</TableHead>
            <TableHead className={cn(HEAD, LG)}>Type</TableHead>
            <TableHead className={cn(HEAD, 'lg:hidden')}>Job</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={HEAD}>Worker</TableHead>
            <TableHead className={cn(HEAD, 'text-right')}>Elapsed</TableHead>
            <TableHead className={cn(HEAD, LG)}>Progress</TableHead>
            <TableHead className={cn(HEAD, LG, 'text-right')}>Attempt</TableHead>
            <TableHead className={cn(HEAD, LG, 'text-right')}>Priority</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const worker = workerOf(job, workers);
            const isOpen = job.id === openId;
            const isSelected = selected.has(job.id);
            return (
              <TableRow
                key={job.id}
                data-state={isSelected ? 'selected' : undefined}
                onClick={() => navigate({ to: '/jobs/$jobId', params: { jobId: String(job.id) }, search: (p) => p })}
                className={cn(
                  'cursor-pointer',
                  isSelected && 'bg-primary/[0.07]',
                  isOpen && 'bg-primary/[0.16] hover:bg-primary/[0.16]',
                )}
              >
                <TableCell className="pl-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select job ${job.id}`}
                    checked={isSelected}
                    onCheckedChange={() => onToggle(job.id)}
                  />
                </TableCell>
                <TableCell className={cn(LG, 'text-right')}>
                  <OpenLink id={job.id} />
                </TableCell>
                <TableCell className={LG}>
                  <TypeChip type={job.type} />
                </TableCell>
                <TableCell className="lg:hidden">
                  <OpenLink id={job.id} className="block" />
                  <TypeChip type={job.type} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={job.status} />
                </TableCell>
                <TableCell>
                  {worker ? (
                    <>
                      <div>{worker.name}</div>
                      <div className="text-xs text-muted-foreground">{worker.ip}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{DASH}</span>
                  )}
                  <div className="text-xs text-muted-foreground tabular-nums lg:hidden">
                    attempt {attemptsShown(job)}/{job.maxAttempt} · priority {job.priority}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Elapsed job={job} now={now} p95={p95} />
                  <div className="lg:hidden">
                    <Progress job={job} />
                  </div>
                </TableCell>
                <TableCell className={LG}>
                  <Progress job={job} />
                </TableCell>
                <TableCell className={cn(LG, 'text-right tabular-nums')}>
                  {attemptsShown(job)}/{job.maxAttempt}
                </TableCell>
                <TableCell className={cn(LG, 'text-right tabular-nums')}>{job.priority}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </table>
    </div>
  );
}

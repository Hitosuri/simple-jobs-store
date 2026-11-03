import { useNavigate } from '@tanstack/react-router';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { JobActions } from './job-actions';
import {
  Attempts,
  Duration,
  ErrorLine,
  OpenLink,
  Progress,
  Started,
  TypeChip,
  workerOf,
  type ListProps,
} from './job-cells';
import { optionalColumns } from './list';

/** Container widths (of the list box, not the viewport) at which lower-priority columns appear. */
const AT_52 = 'hidden @min-[52rem]:table-cell';
const AT_60 = 'hidden @min-[60rem]:table-cell';
const AT_68 = 'hidden @min-[68rem]:table-cell';
const BELOW_68 = '@min-[68rem]:hidden';
const HEAD = 'sticky top-0 z-10 bg-card text-xs text-muted-foreground';

export function JobsTable({
  jobs,
  now,
  p95,
  workers,
  selected,
  openId,
  statusFilter,
  onToggle,
  onToggleAll,
}: ListProps & { onToggleAll: () => void }) {
  const navigate = useNavigate();
  const allOn = jobs.length > 0 && jobs.every((j) => selected.has(j.id));
  const someOn = !allOn && jobs.some((j) => selected.has(j.id));
  const show = optionalColumns(jobs, statusFilter);

  return (
    <table className="w-full table-fixed text-[13px] tabular-nums">
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
          <TableHead className={cn(HEAD, AT_68, 'w-16 text-right')}>ID</TableHead>
          <TableHead className={cn(HEAD, AT_68, 'w-[22%] pl-4')}>Type</TableHead>
          <TableHead className={cn(HEAD, BELOW_68)}>Job</TableHead>
          {show.status && <TableHead className={cn(HEAD, 'w-32')}>Status</TableHead>}
          <TableHead className={cn(HEAD, AT_60)}>Worker</TableHead>
          <TableHead className={cn(HEAD, 'w-40')}>Started</TableHead>
          <TableHead className={cn(HEAD, 'w-28 text-right')}>Duration</TableHead>
          <TableHead className={cn(HEAD, 'w-40 pl-6 @min-[68rem]:w-56')}>Progress</TableHead>
          <TableHead className={cn(HEAD, AT_52, 'w-20 text-right')}>Attempts</TableHead>
          {show.priority && <TableHead className={cn(HEAD, AT_52, 'w-16 text-right')}>Priority</TableHead>}
          <TableHead className={cn(HEAD, 'w-20 pr-3')}>
            <span className="sr-only">Actions</span>
          </TableHead>
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
              <TableCell className={cn(AT_68, 'text-right')}>
                <OpenLink id={job.id} />
              </TableCell>
              <TableCell className={cn(AT_68, 'pl-4')}>
                <div className="flex">
                  <TypeChip type={job.type} />
                </div>
              </TableCell>
              <TableCell className={BELOW_68}>
                <OpenLink id={job.id} className="block" />
                <div className="flex">
                  <TypeChip type={job.type} />
                </div>
              </TableCell>
              {show.status && (
                <TableCell>
                  <StatusBadge status={job.status} />
                </TableCell>
              )}
              <TableCell className={cn(AT_60, 'truncate')}>
                {worker && (
                  <>
                    <span title={worker.name}>{worker.name}</span>
                    <div className="truncate text-xs text-muted-foreground">{worker.ip}</div>
                  </>
                )}
              </TableCell>
              <TableCell className="truncate">
                <Started job={job} />
              </TableCell>
              <TableCell className="truncate text-right">
                <Duration job={job} now={now} p95={p95} />
              </TableCell>
              <TableCell className="pl-6">
                <Progress job={job} />
                <ErrorLine job={job} />
              </TableCell>
              <TableCell className={cn(AT_52, 'text-right')}>
                <Attempts job={job} />
              </TableCell>
              {show.priority && (
                <TableCell className={cn(AT_52, 'text-right', job.priority === 0 && 'text-muted-foreground')}>
                  {job.priority}
                </TableCell>
              )}
              <TableCell className="pr-3">
                <JobActions job={job} variant="row" />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </table>
  );
}

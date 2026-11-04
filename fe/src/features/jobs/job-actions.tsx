import { Fragment, useState, type ReactNode } from 'react';
import { Ban, Ellipsis, ListOrdered, Repeat, RotateCcw, Trash2 } from 'lucide-react';
import { useCancelJob, useDeleteJob, useReplayJob, useRetryJob, useSetPriority } from '@/api/mutations';
import type { BulkAction, Job, ReplayChoices } from '@/api/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ConfirmCancel } from './confirm-cancel';
import { ConfirmDelete } from './confirm-delete';
import { can } from './eligibility';

const INT32 = 2 ** 31;

type JobAction = BulkAction | 'replay';

const META: Record<JobAction, { label: string; icon: ReactNode }> = {
  retry: { label: 'Retry', icon: <RotateCcw /> },
  replay: { label: 'Replay', icon: <Repeat /> },
  cancel: { label: 'Cancel', icon: <Ban /> },
  priority: { label: 'Priority', icon: <ListOrdered /> },
  delete: { label: 'Delete', icon: <Trash2 /> },
};

const NO_REPLAY_CHOICES: ReplayChoices = { overwrite: false, reportSuccess: false, reportFailed: false };

/** The action a job in this state most likely needs, shown as the visible button. */
export function primaryAction(job: Pick<Job, 'status'>): JobAction | null {
  if (can('retry', job.status)) return 'retry';
  if (can('cancel', job.status)) return 'cancel';
  if (job.status === 'success') return 'replay';
  return null;
}

/** Applicable actions after the primary one, Delete last. */
export function secondaryActions(job: Pick<Job, 'status'>): BulkAction[] {
  const primary = primaryAction(job);
  return (['priority', 'retry', 'cancel', 'delete'] as const).filter((a) => a !== primary && can(a, job.status));
}

/**
 * Only the actions that apply to the job's state: the likely one as a button, the rest in a menu.
 * `row` is the compact form for list rows; `panel` is the job detail footer.
 */
export function JobActions({
  job,
  variant,
  onDeleted,
}: {
  job: Job;
  variant: 'row' | 'panel';
  onDeleted?: () => void;
}) {
  const cancel = useCancelJob();
  const retry = useRetryJob();
  const replay = useReplayJob();
  const setPriority = useSetPriority();
  const del = useDeleteJob();
  const [dialog, setDialog] = useState<'cancel' | 'delete' | 'priority' | 'replay' | null>(null);
  const [priority, setPriorityText] = useState(String(job.priority));
  const parsed = Number(priority);
  const priorityValid = priority.trim() !== '' && Number.isInteger(parsed) && Math.abs(parsed) < INT32;
  const [choices, setChoices] = useState(NO_REPLAY_CHOICES);

  const primary = primaryAction(job);
  const rest = secondaryActions(job);
  const busy = cancel.isPending || retry.isPending || replay.isPending || setPriority.isPending || del.isPending;
  const row = variant === 'row';

  function run(action: JobAction) {
    if (action === 'retry') retry.mutate(job.id);
    else if (action === 'priority') {
      setPriorityText(String(job.priority));
      setDialog('priority');
    } else if (action === 'replay') {
      setChoices(NO_REPLAY_CHOICES);
      setDialog('replay');
    } else setDialog(action);
  }

  return (
    <div
      className={cn('flex items-center', row ? 'justify-end gap-0.5' : 'gap-2')}
      onClick={(e) => e.stopPropagation()}
    >
      {row &&
        (primary ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  onClick={() => run(primary)}
                  aria-label={`${META[primary].label} job ${job.id}`}
                  className="text-muted-foreground hover:text-foreground max-md:size-11"
                />
              }
            >
              {META[primary].icon}
            </TooltipTrigger>
            <TooltipContent>{META[primary].label}</TooltipContent>
          </Tooltip>
        ) : (
          <span aria-hidden className="size-7 shrink-0 max-md:size-11" />
        ))}
      {!row && primary && (
        <Button
          variant={primary === 'retry' ? 'default' : 'outline'}
          disabled={busy}
          onClick={() => run(primary)}
          className="flex-1 max-md:h-11"
        >
          {META[primary].icon}
          {META[primary].label}
        </Button>
      )}
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant={row ? 'ghost' : 'outline'}
                size={row ? 'icon-sm' : 'icon'}
                aria-label={`More actions for job ${job.id}`}
                disabled={busy}
                className={cn(row && 'text-muted-foreground hover:text-foreground', 'max-md:size-11')}
              />
            }
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {rest.map((action) => {
              const { label, icon } = META[action];
              return (
                <Fragment key={action}>
                  {action === 'delete' && rest.length > 1 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    variant={action === 'delete' ? 'destructive' : 'default'}
                    onClick={() => run(action)}
                    className="max-md:min-h-11"
                  >
                    {icon}
                    {label}
                  </DropdownMenuItem>
                </Fragment>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {row && rest.length === 0 && <span aria-hidden className="size-7 shrink-0 max-md:size-11" />}

      <ConfirmDelete
        count={1}
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={() => void del.mutateAsync(job.id).then(onDeleted, () => {})}
      />

      <ConfirmCancel
        count={1}
        label={`#${job.id}`}
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={() => cancel.mutate(job.id)}
      />

      <AlertDialog open={dialog === 'replay'} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replay job #{job.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              It runs once more on the next free worker, with no retry if it fails.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex cursor-pointer items-start gap-2">
              <Checkbox
                className="mt-0.5"
                checked={choices.overwrite}
                onCheckedChange={(on) => setChoices(on ? { ...choices, overwrite: true } : NO_REPLAY_CHOICES)}
              />
              <span>
                Overwrite the result
                <span className="block text-xs text-muted-foreground">
                  {choices.overwrite
                    ? 'The job ends with whatever the replay returns, failure included.'
                    : 'The job keeps its current result. The replay outcome shows only in Attempts.'}
                </span>
              </span>
            </label>
            {job.reports && (
              <>
                <label className="flex cursor-pointer items-center gap-2 has-disabled:cursor-not-allowed has-disabled:text-muted-foreground">
                  <Checkbox
                    disabled={!choices.overwrite}
                    checked={choices.reportSuccess}
                    onCheckedChange={(on) => setChoices({ ...choices, reportSuccess: on })}
                  />
                  Send callback if it succeeds
                </label>
                <label className="flex cursor-pointer items-center gap-2 has-disabled:cursor-not-allowed has-disabled:text-muted-foreground">
                  <Checkbox
                    disabled={!choices.overwrite}
                    checked={choices.reportFailed}
                    onCheckedChange={(on) => setChoices({ ...choices, reportFailed: on })}
                  />
                  Send callback if it fails
                </label>
                {!choices.overwrite && (
                  <p className="-mt-1 text-xs text-muted-foreground">
                    Callbacks send the stored result, so they need Overwrite.
                  </p>
                )}
              </>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => replay.mutate({ id: job.id, choices })}>
              Replay #{job.id}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === 'priority'} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set priority for #{job.id}</AlertDialogTitle>
            <AlertDialogDescription>
              Higher numbers are claimed first. Current priority is {job.priority}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="number"
            inputMode="numeric"
            aria-label="Priority"
            value={priority}
            aria-invalid={!priorityValid}
            onChange={(e) => setPriorityText(e.target.value)}
            className="max-md:h-11"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!priorityValid}
              onClick={() => setPriority.mutate({ id: job.id, priority: parsed })}
            >
              Set priority
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { Fragment, useState, type ReactNode } from 'react';
import { Ban, Ellipsis, ListOrdered, RotateCcw, Trash2 } from 'lucide-react';
import { useCancelJob, useDeleteJob, useRetryJob, useSetPriority } from '@/api/mutations';
import type { BulkAction, Job } from '@/api/types';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ConfirmCancel } from './confirm-cancel';
import { ConfirmDelete } from './confirm-delete';
import { can } from './eligibility';

const INT32 = 2 ** 31;

const META: Record<BulkAction, { label: string; icon: ReactNode }> = {
  retry: { label: 'Retry', icon: <RotateCcw /> },
  cancel: { label: 'Cancel', icon: <Ban /> },
  priority: { label: 'Priority', icon: <ListOrdered /> },
  delete: { label: 'Delete', icon: <Trash2 /> },
};

/** The action a job in this state most likely needs, shown as the visible button. */
export function primaryAction(job: Pick<Job, 'status'>): BulkAction | null {
  if (can('retry', job.status)) return 'retry';
  if (can('cancel', job.status)) return 'cancel';
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
  const setPriority = useSetPriority();
  const del = useDeleteJob();
  const [dialog, setDialog] = useState<'cancel' | 'delete' | 'priority' | null>(null);
  const [priority, setPriorityText] = useState(String(job.priority));
  const parsed = Number(priority);
  const priorityValid = priority.trim() !== '' && Number.isInteger(parsed) && Math.abs(parsed) < INT32;

  const primary = primaryAction(job);
  const rest = secondaryActions(job);
  const busy = cancel.isPending || retry.isPending || setPriority.isPending || del.isPending;
  const row = variant === 'row';

  function run(action: BulkAction) {
    if (action === 'retry') retry.mutate(job.id);
    else if (action === 'priority') {
      setPriorityText(String(job.priority));
      setDialog('priority');
    } else setDialog(action);
  }

  return (
    <div className={cn('flex items-center', row ? 'justify-end gap-1' : 'gap-2')} onClick={(e) => e.stopPropagation()}>
      {primary && (
        <Button
          variant={row ? 'outline' : primary === 'retry' ? 'default' : 'outline'}
          size={row ? 'xs' : 'default'}
          disabled={busy}
          onClick={() => run(primary)}
          aria-label={row ? `${META[primary].label} job ${job.id}` : undefined}
          className={cn(row ? 'max-md:h-11 max-md:px-3' : 'flex-1 max-md:h-11')}
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
                size={row ? 'icon-xs' : 'icon'}
                aria-label={`More actions for job ${job.id}`}
                disabled={busy}
                className="max-md:size-11"
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
      {row && rest.length === 0 && <span aria-hidden className="size-6 shrink-0 max-md:size-11" />}

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

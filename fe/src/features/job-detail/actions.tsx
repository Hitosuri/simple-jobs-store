import { useState } from 'react';
import { Ban, ListOrdered, RotateCcw, Trash2, type LucideIcon } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDelete } from '@/features/jobs/confirm-delete';
import { can, whyNot } from '@/features/jobs/eligibility';

const INT32 = 2 ** 31;

export function Actions({ job, onDeleted }: { job: Job; onDeleted: () => void }) {
  const cancel = useCancelJob();
  const retry = useRetryJob();
  const setPriority = useSetPriority();
  const del = useDeleteJob();
  const [dialog, setDialog] = useState<'delete' | 'priority' | null>(null);
  const [priority, setPriorityText] = useState(String(job.priority));
  const parsed = Number(priority);
  const priorityValid = priority.trim() !== '' && Number.isInteger(parsed) && Math.abs(parsed) < INT32;

  const buttons: { action: BulkAction; label: string; Icon: LucideIcon; busy: boolean; run: () => void }[] = [
    { action: 'cancel', label: 'Cancel', Icon: Ban, busy: cancel.isPending, run: () => cancel.mutate(job.id) },
    {
      action: 'priority',
      label: 'Priority',
      Icon: ListOrdered,
      busy: setPriority.isPending,
      run: () => {
        setPriorityText(String(job.priority));
        setDialog('priority');
      },
    },
    { action: 'retry', label: 'Retry', Icon: RotateCcw, busy: retry.isPending, run: () => retry.mutate(job.id) },
    { action: 'delete', label: 'Delete', Icon: Trash2, busy: del.isPending, run: () => setDialog('delete') },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {buttons.map(({ action, label, Icon, busy, run }) => {
          const allowed = can(action, job.status);
          const button = (
            <Button
              variant={action === 'delete' ? 'destructive' : 'outline'}
              disabled={!allowed || busy}
              onClick={run}
              className="w-full max-md:h-11"
            >
              <Icon />
              {label}
            </Button>
          );
          return allowed ? (
            <span key={action} className="flex">
              {button}
            </span>
          ) : (
            <Tooltip key={action}>
              <TooltipTrigger render={<span tabIndex={0} className="flex" />}>{button}</TooltipTrigger>
              <TooltipContent>{whyNot(action, job.status)}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <ConfirmDelete
        count={1}
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={() => del.mutate(job.id, { onSuccess: onDeleted })}
      />

      <AlertDialog open={dialog === 'priority'} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set priority for #{job.id}</AlertDialogTitle>
            <AlertDialogDescription>Higher numbers are claimed first.</AlertDialogDescription>
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
    </>
  );
}

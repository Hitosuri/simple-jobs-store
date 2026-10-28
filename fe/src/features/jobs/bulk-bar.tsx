import { useState } from 'react';
import { Ban, ListOrdered, RotateCcw, Trash2, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useBulk } from '@/api/mutations';
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
import { formatNumber } from '@/lib/format';
import { bulkResultMessage } from './bulk-result';
import { ConfirmCancel } from './confirm-cancel';
import { ConfirmDelete } from './confirm-delete';
import { can, whyNot } from './eligibility';

const INT32 = 2 ** 31;

const ACTIONS: { action: BulkAction; label: string; Icon: LucideIcon }[] = [
  { action: 'cancel', label: 'Cancel', Icon: Ban },
  { action: 'priority', label: 'Priority', Icon: ListOrdered },
  { action: 'retry', label: 'Retry', Icon: RotateCcw },
  { action: 'delete', label: 'Delete', Icon: Trash2 },
];

export function BulkBar({ jobs, onClear }: { jobs: Job[]; onClear: () => void }) {
  const bulk = useBulk();
  const [dialog, setDialog] = useState<'cancel' | 'delete' | 'priority' | null>(null);
  const [priority, setPriority] = useState('0');
  const parsed = Number(priority);
  const priorityValid = priority.trim() !== '' && Number.isInteger(parsed) && Math.abs(parsed) < INT32;

  const eligible = (action: BulkAction) => jobs.filter((j) => can(action, j.status));

  async function run(action: BulkAction, value?: number) {
    const ids = eligible(action).map((j) => j.id);
    try {
      const result = await bulk.mutateAsync({ action, ids, priority: value });
      toast(bulkResultMessage(action, result));
      onClear();
    } catch {
      return;
    }
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-2 rounded-xl border bg-popover p-2 shadow-lg md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:flex-nowrap lg:bottom-4 lg:left-[calc(50%+7rem)]"
      >
        <span className="px-2 text-sm font-medium tabular-nums">{formatNumber(jobs.length)} selected</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear selection"
          onClick={onClear}
          className="ml-auto md:order-last max-md:size-11"
        >
          <X />
        </Button>
        <div className="grid basis-full grid-cols-4 gap-1 md:flex md:basis-auto">
          {ACTIONS.map(({ action, label, Icon }) => {
            const n = eligible(action).length;
            const reason = n ? undefined : whyNot(action, jobs[0]?.status ?? 'success');
            return (
              <span key={action} title={reason} className="flex">
                <Button
                  variant={action === 'delete' ? 'destructive' : 'outline'}
                  disabled={n === 0 || bulk.isPending}
                  onClick={() => (action === 'retry' ? run(action) : setDialog(action))}
                  className="w-full max-md:h-11 max-md:flex-col max-md:gap-0.5 max-md:text-xs"
                >
                  <Icon />
                  {label}
                  <span className="tabular-nums">{n > 0 && n}</span>
                </Button>
              </span>
            );
          })}
        </div>
      </div>

      <ConfirmCancel
        count={eligible('cancel').length}
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={() => run('cancel')}
      />

      <ConfirmDelete
        count={eligible('delete').length}
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        onConfirm={() => run('delete')}
      />

      <AlertDialog open={dialog === 'priority'} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Set priority for {formatNumber(eligible('priority').length)} pending jobs
            </AlertDialogTitle>
            <AlertDialogDescription>Higher numbers are claimed first.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="number"
            inputMode="numeric"
            aria-label="Priority"
            value={priority}
            aria-invalid={!priorityValid}
            onChange={(e) => setPriority(e.target.value)}
            className="max-md:h-11"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!priorityValid} onClick={() => run('priority', parsed)}>
              Set priority
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

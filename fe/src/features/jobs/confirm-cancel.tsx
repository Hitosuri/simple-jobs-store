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
import { formatNumber } from '@/lib/format';

export function ConfirmCancel({
  count,
  label,
  open,
  onOpenChange,
  onConfirm,
}: {
  count: number;
  label?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const noun = count === 1 ? 'job' : 'jobs';
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {label ? `Cancel job ${label}?` : `Cancel ${formatNumber(count)} ${noun}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Running work stops when its worker next reports in. Cancelled {noun} can be retried later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep running</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Cancel {label ?? formatNumber(count)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

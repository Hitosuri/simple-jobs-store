import { toast } from 'sonner';
import { useSendReport } from '@/api/mutations';
import type { Job } from '@/api/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reportLines, type ReportLine } from './wording';

const TONE: Record<ReportLine['tone'], string> = {
  ok: 'text-ok',
  bad: 'text-bad',
  run: 'text-run',
  fg: 'text-foreground',
  muted: 'text-muted-foreground',
};

export function ReportCard({ job, now }: { job: Job; now: number }) {
  const send = useSendReport();
  const lines = reportLines(job, now);
  if (lines.length === 0) return null;
  const canSend =
    (job.status === 'success' || job.status === 'failed') &&
    (job.reportStatus === 'success' || job.reportStatus === 'failed');
  const sendTo = (index: number, url: string) =>
    send.mutate(
      { id: job.id, index },
      {
        onSuccess: (sent) =>
          sent.reportStatus === 'success'
            ? toast.success(`Delivered to ${url}`)
            : toast.error(`Send to ${url} failed: ${sent.reportError}`),
      },
    );
  return (
    <section className="rounded-lg border bg-card px-3 py-2.5 text-[13px]">
      <h3 className="mb-2 font-semibold">{lines.length > 1 ? 'Callbacks' : 'Callback'}</h3>
      <ul className="flex flex-col gap-2">
        {lines.map((line, i) => (
          <li key={i} className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-all text-muted-foreground">{line.url}</p>
              <p className={cn('tabular-nums', TONE[line.tone])}>{line.text}</p>
            </div>
            {canSend && (
              <Button variant="outline" size="xs" disabled={send.isPending} onClick={() => sendTo(i, line.url)}>
                Send again
              </Button>
            )}
          </li>
        ))}
      </ul>
      {job.reportError && <p className="mt-2 text-xs break-words text-bad">Last error: {job.reportError}</p>}
    </section>
  );
}

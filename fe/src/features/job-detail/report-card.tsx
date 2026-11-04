import { LoaderCircle, Send } from 'lucide-react';
import { useSendReport } from '@/api/mutations';
import type { Job } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  const sending = send.isPending ? send.variables.index : null;
  return (
    <section className="rounded-lg border bg-card px-3 py-2.5 text-[13px]">
      <h3 className="mb-2 font-semibold">{lines.length > 1 ? 'Callbacks' : 'Callback'}</h3>
      <ul className="divide-y">
        {lines.map((line, i) => (
          <li key={i} className="min-w-0 py-2 first:pt-0 last:pb-0">
            <p className="break-all text-muted-foreground">{line.url}</p>
            <div className="flex items-center justify-between gap-2">
              <p className={cn('tabular-nums', TONE[line.tone])}>{line.text}</p>
              {canSend && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={sending !== null}
                        aria-busy={sending === i}
                        onClick={() => send.mutate({ id: job.id, index: i })}
                        aria-label={`Send again to ${line.url}`}
                        className="-my-1 shrink-0 text-muted-foreground hover:text-foreground max-md:-my-3 max-md:size-11"
                      />
                    }
                  >
                    {sending === i ? <LoaderCircle className="animate-spin" /> : <Send />}
                  </TooltipTrigger>
                  <TooltipContent>{sending === i ? 'Sending...' : 'Send again, once'}</TooltipContent>
                </Tooltip>
              )}
            </div>
            {line.sent && (
              <p className="text-xs break-words text-muted-foreground tabular-nums">
                {line.sent.at} · <span className={TONE[line.sent.tone]}>{line.sent.outcome}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
      {job.reportError && <p className="mt-2 text-xs break-words text-bad">Last error: {job.reportError}</p>}
    </section>
  );
}

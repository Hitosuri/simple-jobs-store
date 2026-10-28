import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useJob, useOverview, useWorkers } from '@/api/queries';
import type { JobDetail as JobDetailData } from '@/api/types';
import { ApiError } from '@/api/client';
import { BlockError } from '@/components/block-error';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime, buildTimeline } from './timeline';
import { useNow } from '@/lib/use-now';
import { parseJobId } from './job-id';
import { Actions } from './actions';
import { AttemptsTimeline } from './attempts-timeline';
import { Facts } from './facts';
import { Hero } from './hero';
import { JsonBlock } from './json-block';
import { ProgressCard } from './progress-card';

function NotFound({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-4 text-sm">
      <p className="text-base font-semibold">Job not found</p>
      <p className="text-muted-foreground">
        Job #{label} does not exist. It may have been deleted or removed after the retention period.
      </p>
      <Button variant="outline" onClick={onClose} className="max-md:min-h-11">
        Close
      </Button>
    </div>
  );
}

function Loaded({ data, onClose }: { data: JobDetailData; onClose: () => void }) {
  const { job, attempts } = data;
  const now = useNow();
  const overview = useOverview();
  const workers = useWorkers(true);
  const worker = workers.data?.find((w) => w.id === (job.workerId ?? job.lastWorkerId));
  const items = useMemo(() => buildTimeline(attempts, job.requeuedAt, now), [attempts, job.requeuedAt, now]);
  const failure = [job.error, job.errorDetail].filter(Boolean).join('\n\n');

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-4">
        <Hero job={job} now={now} p95={overview.data?.runP95ByType[job.type]} />
        <Facts job={job} attempts={attempts} worker={worker} now={now} />
        {job.progress && job.progress.length > 0 && <ProgressCard steps={job.progress} />}
        <AttemptsTimeline items={items} count={attempts.length} />
        <JsonBlock title="Description" value={job.description} />
        {job.result !== null && <JsonBlock title="Result" value={job.result} />}
        {failure && <JsonBlock title="Error" value={failure} summary={job.error ?? undefined} />}
        <section className="rounded-lg border bg-card px-3 py-2.5 text-[13px]">
          <h3 className="mb-1 flex justify-between font-semibold">
            Report
            <span className="text-xs font-normal text-muted-foreground">
              {job.reports?.length
                ? `${job.reports.length} target${job.reports.length > 1 ? 's' : ''}`
                : 'none configured'}
            </span>
          </h3>
          {job.reportStatus ? (
            <>
              <p
                className={job.reportStatus === 'failed' ? 'text-bad' : job.reportStatus === 'success' ? 'text-ok' : ''}
              >
                {job.reportStatus}
                <span className="text-muted-foreground tabular-nums"> &middot; round {job.reportRound}</span>
              </p>
              {job.reportNextAt && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  next try {formatDateTime(job.reportNextAt)}
                </p>
              )}
              {job.reportError && <p className="mt-0.5 text-xs break-words text-bad">{job.reportError}</p>}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Not reported yet.</p>
          )}
        </section>
      </div>
      <div className="border-t bg-popover p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Actions job={job} onDeleted={onClose} />
      </div>
    </>
  );
}

export function DetailBody({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const id = parseJobId(jobId);
  return id === null ? <NotFound label={jobId} onClose={onClose} /> : <LoadedOrState id={id} onClose={onClose} />;
}

function LoadedOrState({ id, onClose }: { id: number; onClose: () => void }) {
  const job = useJob(id);
  if (job.data) {
    return (
      <>
        {job.isError && (
          <div className="px-3 pb-3">
            <BlockError message={job.error.message} lastGoodAt={job.dataUpdatedAt} onRetry={() => job.refetch()} />
          </div>
        )}
        <Loaded data={job.data} onClose={onClose} />
      </>
    );
  }
  if (job.error instanceof ApiError && job.error.code === 'JOB_NOT_FOUND')
    return <NotFound label={String(id)} onClose={onClose} />;
  if (job.isError) {
    return (
      <div className="p-4">
        <BlockError message={job.error.message} lastGoodAt={job.dataUpdatedAt} onRetry={() => job.refetch()} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 px-3">
      <div className="h-40 rounded-lg bg-inset" />
      <div className="h-24 rounded-lg bg-inset" />
      <div className="h-32 rounded-lg bg-inset" />
    </div>
  );
}

export function JobDetail({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        showCloseButton={false}
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:lg:w-[420px]"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <SheetTitle>Job #{jobId}</SheetTitle>
          <SheetDescription className="sr-only">Job details and actions</SheetDescription>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="max-md:size-11">
            <X />
          </Button>
        </div>
        <DetailBody jobId={jobId} onClose={onClose} />
      </SheetContent>
    </Sheet>
  );
}

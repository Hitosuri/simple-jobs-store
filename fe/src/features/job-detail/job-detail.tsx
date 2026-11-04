import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAtomValue } from 'jotai';
import { ChevronDown, ChevronUp, Link2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useJob, useOverview, useWorkers } from '@/api/queries';
import type { JobDetail as JobDetailData } from '@/api/types';
import { ApiError } from '@/api/client';
import { BlockError } from '@/components/block-error';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { buildTimeline } from './timeline';
import { useNow } from '@/lib/use-now';
import { visibleJobIdsAtom } from '@/lib/selection';
import { workerLabels } from '@/lib/worker-label';
import { neighbors, parseJobId } from './job-id';
import { attemptsShown } from '@/features/jobs/job-cells';
import { JobActions } from '@/features/jobs/job-actions';
import { AttemptsTimeline } from './attempts-timeline';
import { Facts } from './facts';
import { Hero } from './hero';
import { copyText, JsonBlock } from './json-block';
import { ProgressCard } from './progress-card';
import { ReportCard } from './report-card';
import { errorText, retryNote } from './wording';

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

const HERO_ERROR_CHARS = 120;

function Loaded({ data, onClose }: { data: JobDetailData; onClose: () => void }) {
  const { job, attempts } = data;
  const now = useNow();
  const overview = useOverview();
  const workers = useWorkers(true);
  const items = useMemo(() => buildTimeline(attempts, job.requeuedAt, now), [attempts, job.requeuedAt, now]);
  const labels = useMemo(() => workerLabels(workers.data ?? []), [workers.data]);
  const retry = retryNote(job, attempts, now);
  const failure = [job.error && errorText(job.error), job.errorDetail].filter(Boolean).join('\n\n');
  const errorFirst = job.status === 'failed' || retry !== null;
  const heroHasAll = errorFirst && !job.errorDetail && failure.length <= HERO_ERROR_CHARS;
  const errorBlock = failure && !heroHasAll && (
    <JsonBlock
      title="Error"
      value={failure}
      summary={job.error ? errorText(job.error) : undefined}
      defaultOpen={errorFirst}
    />
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-4">
        <Hero job={job} now={now} p95={overview.data?.runP95ByType[job.type]} retry={retry} />
        <Facts job={job} now={now} />
        {errorFirst && errorBlock}
        {job.progress && job.progress.length > 0 && <ProgressCard steps={job.progress} jobStatus={job.status} />}
        <AttemptsTimeline items={items} aside={`${attemptsShown(job)} of ${job.maxAttempt}`} workerLabels={labels} />
        <JsonBlock title="Description" value={job.description} />
        {job.result !== null && job.status === 'success' && <JsonBlock title="Result" value={job.result} />}
        {!errorFirst && errorBlock}
        <ReportCard job={job} now={now} />
      </div>
      <div className="border-t bg-popover p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <JobActions job={job} variant="panel" onDeleted={onClose} />
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
        <Loaded key={id} data={job.data} onClose={onClose} />
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

const WIDE = '(min-width: 1024px)';

function subscribeWide(onChange: () => void) {
  const query = matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => matchMedia(WIDE).matches,
    () => false,
  );

const IGNORE_KEYS_IN =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function Header({
  jobId,
  title,
  onClose,
  keys,
}: {
  jobId: string;
  title: React.ReactNode;
  onClose: () => void;
  keys: boolean;
}) {
  const navigate = useNavigate();
  const { prev, next } = neighbors(useAtomValue(visibleJobIdsAtom), parseJobId(jobId));
  const open = (id?: number) =>
    id !== undefined && navigate({ to: '/jobs/$jobId', params: { jobId: String(id) }, search: (p) => p });

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof Element && e.target.closest(IGNORE_KEYS_IN)) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'j') open(next);
      else if (e.key === 'k') open(prev);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const copyLink = () =>
    copyText(location.href).then(
      () => toast('Link copied'),
      () => toast.error('Could not copy'),
    );

  return (
    <div className="flex items-center gap-1 py-2 pr-2 pl-3">
      {title}
      <Button variant="ghost" size="icon" aria-label="Copy link" onClick={copyLink} className="ml-auto max-md:size-11">
        <Link2 />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous job"
        title={keys ? 'Previous job (k)' : undefined}
        disabled={prev === undefined}
        onClick={() => open(prev)}
        className="max-md:size-11"
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next job"
        title={keys ? 'Next job (j)' : undefined}
        disabled={next === undefined}
        onClick={() => open(next)}
        className="max-md:size-11"
      >
        <ChevronDown />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Close"
        title={keys ? 'Close (Esc)' : undefined}
        onClick={onClose}
        className="max-md:size-11"
      >
        <X />
      </Button>
    </div>
  );
}

const TITLE = 'font-heading text-base font-medium text-foreground tabular-nums outline-none';

/** The non-modal panel does not trap focus, so it takes focus itself to be reachable by keyboard. */
function PanelTitle({ jobId }: { jobId: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), [jobId]);
  return (
    <h2 ref={ref} id="job-detail-title" tabIndex={-1} className={TITLE}>
      Job #{jobId}
    </h2>
  );
}

export function JobDetail({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const wide = useWide();
  if (wide) {
    return (
      <aside
        aria-labelledby="job-detail-title"
        className="fixed inset-y-0 right-0 z-40 flex w-[420px] flex-col border-l bg-popover text-sm text-popover-foreground shadow-lg"
      >
        <Header jobId={jobId} keys onClose={onClose} title={<PanelTitle jobId={jobId} />} />
        <DetailBody jobId={jobId} onClose={onClose} />
      </aside>
    );
  }
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none">
        <Header
          jobId={jobId}
          keys={false}
          onClose={onClose}
          title={<SheetTitle className={TITLE}>Job #{jobId}</SheetTitle>}
        />
        <SheetDescription className="sr-only">Job details and actions</SheetDescription>
        <DetailBody jobId={jobId} onClose={onClose} />
      </SheetContent>
    </Sheet>
  );
}

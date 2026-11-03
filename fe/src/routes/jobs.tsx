import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Outlet, stripSearchParams, useMatch, useNavigate } from '@tanstack/react-router';
import { useAtom, useSetAtom } from 'jotai';
import { useJobCounts, useJobs, useOverview, useStats, useWorkers } from '@/api/queries';
import { BlockError } from '@/components/block-error';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BulkBar } from '@/features/jobs/bulk-bar';
import { Filters } from '@/features/jobs/filters';
import { JobCards } from '@/features/jobs/job-cards';
import { JobsTable } from '@/features/jobs/jobs-table';
import { knownTypes } from '@/features/jobs/list';
import { Pager } from '@/features/jobs/pager';
import { JOBS_DEFAULTS, jobsSearchSchema, toJobsSearch, type JobsUrlSearch } from '@/features/jobs/search';
import { StatusTabs } from '@/features/jobs/status-tabs';
import { selectedJobIdsAtom, visibleJobIdsAtom } from '@/lib/selection';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';

function JobsScreen() {
  const rawSearch = Route.useSearch();
  const search = useMemo(() => jobsSearchSchema.parse(rawSearch), [rawSearch]);
  const navigate = useNavigate();
  const now = useNow();
  const minute = Math.floor(now / 60_000) * 60_000;
  const apiSearch = useMemo(() => toJobsSearch(search, minute), [search, minute]);
  const jobs = useJobs(apiSearch);
  const counts = useJobCounts(apiSearch);
  const workers = useWorkers(true);
  const overview = useOverview();
  const stats = useStats('7d');
  const [selected, setSelected] = useAtom(selectedJobIdsAtom);
  const setVisibleIds = useSetAtom(visibleJobIdsAtom);
  const [selectMode, setSelectMode] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const detailMatch = useMatch({ from: '/jobs/$jobId', shouldThrow: false });
  const openId = Number(detailMatch?.params.jobId) || undefined;

  const items = useMemo(() => jobs.data?.items ?? [], [jobs.data]);
  const workerMap = useMemo(() => new Map((workers.data ?? []).map((w) => [w.id, w])), [workers.data]);
  const typeOptions = useMemo(
    () =>
      knownTypes(
        overview.data?.pendingByType.map((t) => t.type),
        overview.data?.workers.flatMap((w) => w.running.map((r) => r.type)),
        stats.data?.byType.map((t) => t.type),
        items.map((j) => j.type),
        search.type,
      ),
    [overview.data, stats.data, items, search.type],
  );
  const selectedJobs = items.filter((j) => selected.has(j.id));

  useEffect(() => setVisibleIds(items.map((j) => j.id)), [items, setVisibleIds]);

  function setSearch(patch: Partial<JobsUrlSearch>) {
    setSelected(new Set());
    navigate({ to: '/jobs', search: (prev) => ({ ...prev, page: 1, ...patch }) });
  }

  function toggle(id: number) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    const all = items.length > 0 && items.every((j) => selected.has(j.id));
    setSelected(all ? new Set() : new Set(items.map((j) => j.id)));
  }

  function clearFilters() {
    setSelected(new Set());
    setResetKey((k) => k + 1);
    navigate({ to: '/jobs', search: {} });
  }

  function toggleSelectMode() {
    setSelected(new Set());
    setSelectMode(!selectMode);
  }

  const listProps = {
    jobs: items,
    now,
    p95: overview.data?.runP95ByType ?? {},
    workers: workerMap,
    selected,
    openId,
    statusFilter: search.status,
  };
  const total = jobs.data?.total ?? 0;
  const filtered = !!(search.status || search.type || search.worker || search.q || search.created !== 'all');

  const lastPage = Math.max(1, Math.ceil(total / search.pageSize));
  const pastEnd = !!jobs.data && items.length === 0 && total > 0 && search.page > lastPage;

  useEffect(() => {
    if (pastEnd) navigate({ to: '/jobs', search: (prev) => ({ ...prev, page: lastPage }), replace: true });
  }, [pastEnd, lastPage, navigate]);

  let body: React.ReactNode;
  if (!jobs.data) {
    body = jobs.isError ? (
      <div className="p-4">
        <BlockError message={jobs.error.message} lastGoodAt={jobs.dataUpdatedAt} onRetry={() => jobs.refetch()} />
      </div>
    ) : (
      <div className="flex flex-col gap-1 p-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-12 rounded-md bg-inset" />
        ))}
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-2 p-4 text-sm text-muted-foreground">
        {total > 0 ? (
          <>
            <p>No jobs on this page.</p>
            <Button variant="outline" onClick={() => setSearch({ page: 1 })} className="max-md:min-h-11">
              Go to first page
            </Button>
          </>
        ) : filtered ? (
          <>
            <p>No jobs match these filters.</p>
            <Button variant="outline" onClick={clearFilters} className="max-md:min-h-11">
              Clear filters
            </Button>
          </>
        ) : (
          <p>No jobs yet. Jobs appear here once a producer submits them.</p>
        )}
      </div>
    );
  } else {
    body = (
      <>
        <div className="hidden @min-[44rem]:block">
          <JobsTable {...listProps} onToggle={toggle} onToggleAll={toggleAll} />
        </div>
        <div className="p-2 @min-[44rem]:hidden">
          <JobCards {...listProps} onToggle={toggle} selectMode={selectMode} />
        </div>
      </>
    );
  }

  const bulk = selectedJobs.length > 0;

  return (
    <div data-fill-viewport className={cn('flex flex-col md:min-h-0 md:flex-1', detailMatch && 'lg:pr-[436px]')}>
      <PageHeader
        title="Jobs"
        actions={
          <Button
            variant={selectMode ? 'default' : 'outline'}
            aria-pressed={selectMode}
            onClick={toggleSelectMode}
            className="md:hidden max-md:h-11"
          >
            Select
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <StatusTabs
          value={search.status?.length === 1 ? search.status[0] : undefined}
          counts={counts.data}
          onChange={(s) => setSearch({ status: s && [s] })}
        />
        <Filters
          key={resetKey}
          search={search}
          typeOptions={typeOptions}
          workers={workers.data ?? []}
          onChange={setSearch}
        />
        {jobs.data && jobs.isError && (
          <Card className="shrink-0 px-4">
            <BlockError message={jobs.error.message} lastGoodAt={jobs.dataUpdatedAt} onRetry={() => jobs.refetch()} />
          </Card>
        )}
        <Card className="@container min-h-0 flex-1 gap-0 overflow-clip py-0">
          <div className="min-h-0 flex-1 md:overflow-auto">{body}</div>
          {jobs.data && (bulk || total > 0) && (
            <div
              className={cn(
                'flex items-center border-t bg-card px-3 py-2 @min-[44rem]:h-12 @min-[44rem]:py-0',
                bulk && 'z-20 max-md:sticky max-md:bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]',
              )}
            >
              {bulk ? (
                <BulkBar jobs={selectedJobs} onClear={() => setSelected(new Set())} />
              ) : (
                <Pager
                  page={search.page}
                  pageSize={search.pageSize}
                  total={total}
                  shown={items.length}
                  onPage={(page) => setSearch({ page })}
                  onPageSize={(pageSize) => setSearch({ pageSize })}
                />
              )}
            </div>
          )}
        </Card>
      </div>
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute('/jobs')({
  validateSearch: (raw: Record<string, unknown>): Partial<JobsUrlSearch> => jobsSearchSchema.parse(raw),
  search: { middlewares: [stripSearchParams(JOBS_DEFAULTS)] },
  component: JobsScreen,
});

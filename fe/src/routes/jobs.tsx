import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Outlet, stripSearchParams, useMatch, useNavigate } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useJobCounts, useJobs, useOverview, useWorkers } from '@/api/queries';
import { BlockError } from '@/components/block-error';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BulkBar } from '@/features/jobs/bulk-bar';
import { Filters } from '@/features/jobs/filters';
import { JobCards } from '@/features/jobs/job-cards';
import { JobsTable } from '@/features/jobs/jobs-table';
import { JOBS_DEFAULTS, jobsSearchSchema, toJobsSearch, type JobsUrlSearch } from '@/features/jobs/search';
import { StatusTabs } from '@/features/jobs/status-tabs';
import { formatNumber } from '@/lib/format';
import { selectedJobIdsAtom } from '@/lib/selection';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';

const PAGE_SIZES = [25, 50, 100].map((n) => ({ value: String(n), label: `${n} / page` }));

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
  const [selected, setSelected] = useAtom(selectedJobIdsAtom);
  const [selectMode, setSelectMode] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const openId = Number(useMatch({ from: '/jobs/$jobId', shouldThrow: false })?.params.jobId) || undefined;

  const items = useMemo(() => jobs.data?.items ?? [], [jobs.data]);
  const workerMap = useMemo(() => new Map((workers.data ?? []).map((w) => [w.id, w])), [workers.data]);
  const typeOptions = useMemo(
    () => [...new Set([...items.map((j) => j.type), ...(search.type ?? [])])].sort(),
    [items, search.type],
  );
  const selectedJobs = items.filter((j) => selected.has(j.id));

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

  const listProps = { jobs: items, now, p95: overview.data?.runP95ByType ?? {}, workers: workerMap, selected, openId };
  const total = jobs.data?.total ?? 0;
  const from = (search.page - 1) * search.pageSize + 1;
  const to = Math.min(from + items.length - 1, total);
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
        <div className="hidden md:block">
          <JobsTable {...listProps} onToggle={toggle} onToggleAll={toggleAll} />
        </div>
        <div className="p-2 md:hidden">
          <JobCards {...listProps} onToggle={toggle} selectMode={selectMode} />
        </div>
      </>
    );
  }

  return (
    <>
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
      <div className={cn('flex flex-col gap-3', selectedJobs.length > 0 && 'pb-32 md:pb-24')}>
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
          <Card className="px-4">
            <BlockError message={jobs.error.message} lastGoodAt={jobs.dataUpdatedAt} onRetry={() => jobs.refetch()} />
          </Card>
        )}
        <Card className="gap-0 overflow-hidden py-0">
          {body}
          {jobs.data && total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {formatNumber(from)}-{formatNumber(to)} / {formatNumber(total)}
              </span>
              <div className="flex items-center gap-1">
                <Select
                  items={PAGE_SIZES}
                  value={String(search.pageSize)}
                  onValueChange={(v) => v && setSearch({ pageSize: Number(v) as JobsUrlSearch['pageSize'] })}
                >
                  <SelectTrigger size="sm" aria-label="Page size" className="max-md:h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {PAGE_SIZES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous page"
                  disabled={search.page <= 1}
                  onClick={() => setSearch({ page: search.page - 1 })}
                  className="max-md:size-11"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next page"
                  disabled={to >= total}
                  onClick={() => setSearch({ page: search.page + 1 })}
                  className="max-md:size-11"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
      {selectedJobs.length > 0 && <BulkBar jobs={selectedJobs} onClear={() => setSelected(new Set())} />}
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/jobs')({
  validateSearch: (raw: Record<string, unknown>): Partial<JobsUrlSearch> => jobsSearchSchema.parse(raw),
  search: { middlewares: [stripSearchParams(JOBS_DEFAULTS)] },
  component: JobsScreen,
});

import { useMemo } from 'react';
import { createFileRoute, Outlet, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { useAttempts, useOverview, useWorkers } from '@/api/queries';
import { BlockError } from '@/components/block-error';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  groupByMachine,
  layoutLanes,
  MACHINES_DEFAULTS,
  machinesSearchSchema,
  RANGES,
  type MachinesUrlSearch,
} from '@/features/machines/lanes';
import { Swimlane } from '@/features/machines/swimlane';
import { useAttemptWindow } from '@/features/machines/use-window';
import { useNow } from '@/lib/use-now';

function MachinesScreen() {
  const rawSearch = Route.useSearch();
  const search = useMemo(() => machinesSearchSchema.parse(rawSearch), [rawSearch]);
  const navigate = useNavigate();
  const now = useNow();
  const workers = useWorkers(search.offline);
  const overview = useOverview();
  const win = useAttemptWindow(RANGES[search.range]);
  const attempts = useAttempts(win.fromIso, win.toIso);
  const lanes = useMemo(() => layoutLanes(attempts.data ?? [], win.from, win.to), [attempts.data, win.from, win.to]);
  const shown = useMemo(
    () => (search.offline ? workers.data : workers.data?.filter((w) => w.connected)) ?? [],
    [workers.data, search.offline],
  );
  const groups = useMemo(() => groupByMachine(shown), [shown]);
  const hiddenOffline = (workers.data?.length ?? 0) - shown.length;
  const busy = useMemo(
    () => new Map(overview.data?.workers.map((l) => [l.worker.id, l.running.length])),
    [overview.data],
  );

  function setSearch(patch: Partial<MachinesUrlSearch>) {
    navigate({ from: '/machines', to: '/machines', search: (prev) => ({ ...prev, ...patch }) });
  }

  let lanesBody: React.ReactNode;
  if (!workers.data) {
    lanesBody = workers.isError ? (
      <BlockError
        message={workers.error.message}
        lastGoodAt={workers.dataUpdatedAt}
        onRetry={() => workers.refetch()}
      />
    ) : (
      <div className="h-40 rounded-md bg-inset" />
    );
  } else if (shown.length === 0) {
    lanesBody = (
      <p className="text-sm text-muted-foreground">
        No workers {search.offline ? 'registered' : 'online'}. Start a worker to see its lane here.
      </p>
    );
  } else {
    lanesBody = (
      <>
        {workers.isError && (
          <div className="mb-2">
            <BlockError
              message={workers.error.message}
              lastGoodAt={workers.dataUpdatedAt}
              onRetry={() => workers.refetch()}
            />
          </div>
        )}
        {attempts.isError && (
          <div className="mb-2">
            <BlockError
              message={attempts.error.message}
              lastGoodAt={attempts.dataUpdatedAt}
              onRetry={() => attempts.refetch()}
            />
          </div>
        )}
        <Swimlane groups={groups} lanes={lanes} busy={busy} from={win.from} to={win.to} now={now} />
        {attempts.data?.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">No attempts in this range. Try a longer one.</p>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Machines" />
      <Card className="gap-2 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold">Attempts per worker</h2>
          <div className="flex items-center gap-2">
            <Toggle
              variant="outline"
              pressed={search.offline}
              onPressedChange={(offline) => setSearch({ offline })}
              className="max-md:h-11"
            >
              Show offline{hiddenOffline > 0 && ` (${hiddenOffline})`}
            </Toggle>
            <ToggleGroup
              value={[search.range]}
              onValueChange={(v) => v[0] && setSearch({ range: v[0] as MachinesUrlSearch['range'] })}
              variant="outline"
              spacing={0}
              aria-label="Time range"
            >
              {Object.keys(RANGES).map((r) => (
                <ToggleGroupItem key={r} value={r} className="max-md:h-11 max-md:min-w-11">
                  {r}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        {lanesBody}
      </Card>
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/machines')({
  validateSearch: (raw: Record<string, unknown>): Partial<MachinesUrlSearch> => machinesSearchSchema.parse(raw),
  search: { middlewares: [stripSearchParams(MACHINES_DEFAULTS)] },
  component: MachinesScreen,
});

import { Link } from '@tanstack/react-router';
import type { Alert, WorkerLoad } from '@/api/types';
import { formatAgo } from '@/lib/format';
import { workerLabels } from '@/lib/worker-label';
import { alertText, groupAlerts } from './summary';

const MAX_SHOWN = 3;

export function AlertBanner({ alerts, workers, now }: { alerts: Alert[]; workers: WorkerLoad[]; now: number }) {
  if (alerts.length === 0) return null;
  const names = workerLabels(workers.map((l) => l.worker));
  const groups = groupAlerts(alerts);
  const shown = groups.slice(0, MAX_SHOWN);
  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-md border border-bad/35 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--bad)_15%,transparent),color-mix(in_srgb,var(--bad)_3%,transparent))] px-3 py-2 text-[13px]">
      <p role="status" className="sr-only">
        {shown.map((g) => alertText(g, names.get(g.workerId) ?? g.workerId)).join('. ')}
      </p>
      {shown.map((g) => {
        const name = names.get(g.workerId) ?? g.workerId;
        return (
          <div key={g.workerId} className="flex items-center gap-2.5">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-bad" />
            <span aria-hidden className="min-w-0">
              {alertText(g, name, formatAgo(g.lostAt ?? g.latestAt, now))}
            </span>
            <Link
              to="/machines/$workerId"
              params={{ workerId: g.workerId }}
              aria-label={`View worker ${name}`}
              className="ml-auto inline-flex shrink-0 items-center font-semibold whitespace-nowrap max-md:min-h-11"
            >
              View worker
            </Link>
          </div>
        );
      })}
      {groups.length > MAX_SHOWN && (
        <span className="text-xs text-muted-foreground">
          +{groups.length - MAX_SHOWN} more {groups.length - MAX_SHOWN === 1 ? 'worker' : 'workers'}
        </span>
      )}
    </div>
  );
}

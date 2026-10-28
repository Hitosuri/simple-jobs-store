import { Link } from '@tanstack/react-router';
import type { Alert } from '@/api/types';
import { formatAgo } from '@/lib/format';

const MAX_SHOWN = 3;

function AlertRow({ alert, now }: { alert: Alert; now: number }) {
  const when = formatAgo(alert.at, now);
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-bad" />
      <span className="min-w-0">
        <b className="font-semibold">{alert.workerId}</b>{' '}
        {alert.kind === 'worker_lost' ? `lost its lease ${when}` : `had job ${alert.jobId} expire ${when}`}
      </span>
      {alert.kind === 'worker_lost' || alert.jobId === null ? (
        <Link to="/machines/$workerId" params={{ workerId: alert.workerId }} className="ml-auto font-semibold">
          View
        </Link>
      ) : (
        <Link to="/jobs/$jobId" params={{ jobId: String(alert.jobId) }} className="ml-auto font-semibold">
          View
        </Link>
      )}
    </div>
  );
}

export function AlertBanner({ alerts, now }: { alerts: Alert[]; now: number }) {
  if (alerts.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-3 flex flex-col gap-1.5 rounded-md border border-bad/35 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--bad)_15%,transparent),color-mix(in_srgb,var(--bad)_3%,transparent))] px-3 py-2 text-[13px]"
    >
      {alerts.slice(0, MAX_SHOWN).map((a, i) => (
        <AlertRow key={`${a.kind}-${a.workerId}-${a.jobId}-${a.at}-${i}`} alert={a} now={now} />
      ))}
      {alerts.length > MAX_SHOWN && (
        <span className="text-xs text-muted-foreground">+{alerts.length - MAX_SHOWN} more</span>
      )}
    </div>
  );
}

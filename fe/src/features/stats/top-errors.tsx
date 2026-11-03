import { Link } from '@tanstack/react-router';
import type { ErrorCount } from '@/api/types';
import { labelIfStatus } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { TypeChip } from '@/features/jobs/job-cells';
import { formatNumber } from '@/lib/format';

export function TopErrors({ errors }: { errors: ErrorCount[] }) {
  return (
    <Card className="gap-2 px-4">
      <h2 className="text-[13px] font-semibold">Attempt errors</h2>
      <p className="-mt-1 text-xs text-muted-foreground">Every failed try, including ones that were retried.</p>
      {errors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No failed attempts in this range.</p>
      ) : (
        <ul className="divide-y divide-border">
          {errors.map((e) => (
            <li key={`${e.type}\0${e.error}`}>
              <Link
                to="/jobs"
                search={{ q: e.error, type: [e.type] }}
                className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2 text-[13px] hover:bg-inset"
              >
                <div className="min-w-0 flex-1">
                  <p title={e.error} className="line-clamp-2 break-words">
                    {labelIfStatus(e.error)}
                  </p>
                  <div className="mt-0.5 text-xs">
                    <TypeChip type={e.type} />
                  </div>
                </div>
                <span className="font-semibold tabular-nums">{formatNumber(e.count)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

import type { ErrorCount } from '@/api/types';
import { Card } from '@/components/ui/card';
import { TypeChip } from '@/features/jobs/job-cells';
import { formatNumber } from '@/lib/format';

export function TopErrors({ errors }: { errors: ErrorCount[] }) {
  return (
    <Card className="gap-2 px-4">
      <h2 className="text-[13px] font-semibold">Top errors</h2>
      {errors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No errors in this range.</p>
      ) : (
        <ul className="divide-y divide-border">
          {errors.map((e) => (
            <li key={`${e.type}\0${e.error}`} className="flex items-start gap-3 py-2 text-[13px]">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words">{e.error}</p>
                <div className="mt-0.5 text-xs">
                  <TypeChip type={e.type} />
                </div>
              </div>
              <span className="font-semibold tabular-nums">{formatNumber(e.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

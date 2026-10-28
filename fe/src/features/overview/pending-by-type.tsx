import type { TypeQueue } from '@/api/types';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';

export function PendingByType({ queues }: { queues: TypeQueue[] }) {
  const sorted = [...queues].sort((a, b) => b.pending - a.pending);
  const max = sorted[0]?.pending ?? 0;
  return (
    <Card className="gap-0 px-4">
      <div className="mb-1 text-xs font-medium text-muted-foreground">Waiting by type</div>
      {sorted.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No pending jobs.</p>
      ) : (
        sorted.map((q) => (
          <div key={q.type} className="my-2 flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate" title={q.type}>
              {q.type}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
              <span
                className="block h-full"
                style={{ width: `${(q.pending / max) * 100}%`, background: typeColorVar(q.type) }}
              />
            </span>
            <span className="w-10 text-right text-muted-foreground tabular-nums">{formatNumber(q.pending)}</span>
          </div>
        ))
      )}
    </Card>
  );
}

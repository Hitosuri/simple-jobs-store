import { WifiOff } from 'lucide-react';
import { formatClock } from '@/lib/format';
import { useLiveStatus } from '@/lib/live';
import { useNow } from '@/lib/use-now';

export function StaleBar() {
  const { state, lastSuccessAt } = useLiveStatus();
  const now = useNow();
  if (state === 'live') return null;
  const since =
    lastSuccessAt === null
      ? 'no data received yet'
      : `showing data from ${formatClock(new Date(lastSuccessAt).toISOString(), now)}`;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border border-warn/35 bg-warn/10 px-3 py-2 text-[13px] text-warn">
      <WifiOff aria-hidden className="size-4 shrink-0" />
      <span>Disconnected - {since}. Retrying...</span>
    </div>
  );
}

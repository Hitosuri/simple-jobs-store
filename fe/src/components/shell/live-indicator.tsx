import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatAgo } from '@/lib/format';
import { useLiveStatus } from '@/lib/live';

const clock = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function LiveIndicator({ className }: { className?: string }) {
  const { state, lastSuccessAt } = useLiveStatus();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const live = state === 'live';
  const word = live ? 'Live' : 'Disconnected';
  let detail = '';
  if (lastSuccessAt !== null) {
    detail = live
      ? ` · updated ${formatAgo(new Date(lastSuccessAt).toISOString(), now)}`
      : ` · data from ${clock.format(lastSuccessAt)}`;
  }

  return (
    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <span
        aria-hidden
        className={cn(
          'size-[7px] shrink-0 rounded-full',
          live ? 'bg-ok shadow-[0_0_0_3px_color-mix(in_srgb,var(--ok)_20%,transparent)]' : 'bg-bad',
        )}
      />
      <span role="status" className="sr-only">
        {word}
      </span>
      <span aria-hidden>
        {word}
        {detail}
      </span>
    </div>
  );
}

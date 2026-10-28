import { useMemo } from 'react';
import { useNow } from '@/lib/use-now';

const STEP_MS = 3_000;

export function useAttemptWindow(spanMs: number) {
  const step = Math.floor(useNow() / STEP_MS) * STEP_MS;
  return useMemo(
    () => ({
      from: step - spanMs,
      to: step,
      fromIso: new Date(step - spanMs).toISOString(),
      toIso: new Date(step).toISOString(),
    }),
    [step, spanMs],
  );
}

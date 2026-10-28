export type Tone = 'fg' | 'warn' | 'bad';

export const toneClass: Record<Tone, string> = { fg: 'text-foreground', warn: 'text-warn', bad: 'text-bad' };

export function pendingTone(oldestWaitMs: number | null): 'fg' | 'warn' {
  return oldestWaitMs !== null && oldestWaitMs > 300_000 ? 'warn' : 'fg';
}

export function rateTone(rate: number | null): Tone {
  if (rate === null) return 'fg';
  if (rate < 0.8) return 'bad';
  return rate < 0.95 ? 'warn' : 'fg';
}

export function failedTone(n: number): 'fg' | 'bad' {
  return n > 0 ? 'bad' : 'fg';
}

export function elapsedTone(ms: number, p95?: number): 'fg' | 'warn' {
  return p95 !== undefined && ms > p95 ? 'warn' : 'fg';
}

const pad = (n: number) => String(n).padStart(2, '0');

function split(ms: number) {
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86_400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
}

export function formatDuration(ms: number): string {
  const { d, h, m, s } = split(Math.max(ms, 0));
  if (d > 0) return `${d}d ${pad(h)}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatPercent(ratio: number | null, digits = 1): string {
  if (ratio === null) return '-';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatAgo(iso: string, now: number): string {
  return `${formatDuration(now - Date.parse(iso)).split(' ')[0]} ago`;
}

export function parseJobId(raw: string): number | null {
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseJobId(raw: string): number | null {
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The jobs before and after `id` in the list order; both undefined when `id` is not in the list. */
export function neighbors(ids: number[], id: number | null): { prev?: number; next?: number } {
  const i = id === null ? -1 : ids.indexOf(id);
  return i === -1 ? {} : { prev: ids[i - 1], next: ids[i + 1] };
}

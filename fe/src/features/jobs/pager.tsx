import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatNumber } from '@/lib/format';
import { parsePage } from './list';
import type { JobsUrlSearch } from './search';

const PAGE_SIZES = [25, 50, 100].map((n) => ({ value: String(n), label: `${n} / page` }));

type PageSize = JobsUrlSearch['pageSize'];

export function Pager({
  page,
  pageSize,
  total,
  shown,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: PageSize;
  total: number;
  shown: number;
  onPage: (page: number) => void;
  onPageSize: (size: PageSize) => void;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(from + shown - 1, total);

  function commit(input: HTMLInputElement) {
    const next = parsePage(input.value, last);
    if (next !== null && next !== page) onPage(next);
    else input.value = String(page);
  }

  const step = (label: string, target: number, Icon: typeof ChevronLeft) => (
    <Button
      variant="outline"
      size="icon"
      aria-label={label}
      disabled={target < 1 || target > last || target === page}
      onClick={() => onPage(target)}
      className="max-md:size-11"
    >
      <Icon />
    </Button>
  );

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
      <div className="flex items-center gap-3">
        <span>
          {formatNumber(from)}-{formatNumber(to)} of {formatNumber(total)}
        </span>
        <Select
          items={PAGE_SIZES}
          value={String(pageSize)}
          onValueChange={(v) => v && onPageSize(Number(v) as PageSize)}
        >
          <SelectTrigger aria-label="Page size" className="max-md:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {PAGE_SIZES.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        {step('First page', 1, ChevronFirst)}
        {step('Previous page', page - 1, ChevronLeft)}
        <label className="flex items-center gap-1.5 px-1.5">
          Page
          <Input
            key={page}
            type="text"
            inputMode="numeric"
            aria-label={`Page number, 1 to ${last}`}
            defaultValue={page}
            onBlur={(e) => commit(e.currentTarget)}
            onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget)}
            onFocus={(e) => e.currentTarget.select()}
            className="w-12 text-center tabular-nums max-md:h-11"
          />
          of {formatNumber(last)}
        </label>
        {step('Next page', page + 1, ChevronRight)}
        {step('Last page', last, ChevronLast)}
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { pageItems } from './list';
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

  const step = (label: string, target: number, icon: ReactNode) => (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={target < 1 || target > last}
      onClick={() => onPage(target)}
      className="max-md:size-11"
    >
      {icon}
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
      {last > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-0.5">
          {step('Previous page', page - 1, <ChevronLeft />)}
          <span className="px-2 text-foreground md:hidden">
            {formatNumber(page)} / {formatNumber(last)}
          </span>
          {pageItems(page, last).map((item, i) =>
            item === 'gap' ? (
              <span key={`gap-${i}`} aria-hidden className="hidden w-7 text-center md:block">
                ...
              </span>
            ) : (
              <Button
                key={item}
                variant={item === page ? 'outline' : 'ghost'}
                size="sm"
                aria-label={`Page ${item}`}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => item !== page && onPage(item)}
                className={cn(
                  'hidden min-w-7 px-1.5 tabular-nums md:inline-flex',
                  item === page ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {item}
              </Button>
            ),
          )}
          {step('Next page', page + 1, <ChevronRight />)}
        </nav>
      )}
    </div>
  );
}

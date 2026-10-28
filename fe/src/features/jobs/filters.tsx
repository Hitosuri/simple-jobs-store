import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import type { Worker } from '@/api/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { JOBS_DEFAULTS, type JobsUrlSearch } from './search';

const ANY = '__any';
const SEARCH_DEBOUNCE_MS = 300;

const CREATED = [
  { value: 'all', label: 'Any time' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

const SORT = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'priority', label: 'Priority' },
  { value: 'running_longest', label: 'Running longest' },
];

export interface FilterProps {
  search: JobsUrlSearch;
  typeOptions: string[];
  workers: Worker[];
  onChange: (patch: Partial<JobsUrlSearch>) => void;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select items={options} value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger aria-label={label} className="max-md:h-11 max-md:w-full md:min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TypeFilter({
  selected,
  options,
  onChange,
}: {
  selected: string[];
  options: string[];
  onChange: (t: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="max-md:h-11 max-md:w-full max-md:justify-between" />}
      >
        {selected.length ? `Type: ${selected.length}` : 'All types'}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {options.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No types on this page</p>}
        {options.map((t) => (
          <DropdownMenuCheckboxItem
            key={t}
            checked={selected.includes(t)}
            onCheckedChange={(on) => onChange(on ? [...selected, t] : selected.filter((x) => x !== t))}
            className="max-md:min-h-11"
          >
            {t}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Controls({ search, typeOptions, workers, onChange }: FilterProps) {
  const workerOptions = [
    { value: ANY, label: 'All workers' },
    ...workers.map((w) => ({ value: w.id, label: w.name })),
    ...(search.worker && !workers.some((w) => w.id === search.worker)
      ? [{ value: search.worker, label: search.worker }]
      : []),
  ];
  return (
    <>
      <TypeFilter
        selected={search.type ?? []}
        options={typeOptions}
        onChange={(t) => onChange({ type: t.length ? t : undefined })}
      />
      <FilterSelect
        label="Worker"
        value={search.worker ?? ANY}
        options={workerOptions}
        onChange={(v) => onChange({ worker: v === ANY ? undefined : v })}
      />
      <FilterSelect
        label="Created"
        value={search.created}
        options={CREATED}
        onChange={(v) => onChange({ created: v as JobsUrlSearch['created'] })}
      />
      <FilterSelect
        label="Sort"
        value={search.sort}
        options={SORT}
        onChange={(v) => onChange({ sort: v as JobsUrlSearch['sort'] })}
      />
    </>
  );
}

export function Filters(props: FilterProps) {
  const { search, onChange } = props;
  const [text, setText] = useState(search.q ?? '');
  const [sheetOpen, setSheetOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const active =
    (search.type?.length ?? 0) +
    Number(!!search.worker) +
    Number(search.created !== JOBS_DEFAULTS.created) +
    Number(search.sort !== JOBS_DEFAULTS.sort);

  function typeQuery(value: string) {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ q: value.trim() || undefined }), SEARCH_DEBOUNCE_MS);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 md:max-w-64">
        <Search aria-hidden className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search jobs"
          placeholder="Search id or description"
          value={text}
          onChange={(e) => typeQuery(e.target.value)}
          className="pl-8 max-md:h-11"
        />
      </div>
      <div className="hidden items-center gap-2 md:flex">
        <Controls {...props} />
      </div>
      <Button variant="outline" onClick={() => setSheetOpen(true)} className="md:hidden max-md:h-11">
        <SlidersHorizontal />
        Filters{active > 0 && <span className="tabular-nums">({active})</span>}
      </Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="md:hidden">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-6">
            <Controls {...props} />
            <Button onClick={() => setSheetOpen(false)} className="h-11">
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

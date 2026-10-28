import { Link, useNavigate } from '@tanstack/react-router';
import type { TypeStats } from '@/api/types';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { rateTone, toneClass } from '@/features/overview/thresholds';
import { formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { typeColorVar } from '@/lib/type-color';
import { cn } from '@/lib/utils';

const HEAD = 'text-xs text-muted-foreground';
const NUM = 'text-right tabular-nums';
const dash = '\u{2014}';
const ms = (v: number | null) => (v === null ? dash : formatDuration(v));

export function TypeTable({ rows }: { rows: TypeStats[] }) {
  const navigate = useNavigate();
  return (
    <Card className="gap-2 px-0">
      <h2 className="px-4 text-[13px] font-semibold">By type</h2>
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, 'pl-4')}>Type</TableHead>
            <TableHead className={cn(HEAD, NUM)}>Finished</TableHead>
            <TableHead className={cn(HEAD, NUM)}>Success</TableHead>
            <TableHead className={cn(HEAD, NUM)}>Run p50</TableHead>
            <TableHead className={cn(HEAD, NUM)}>Run p95</TableHead>
            <TableHead className={cn(HEAD, NUM)}>Wait p95</TableHead>
            <TableHead className={cn(HEAD, NUM, 'pr-4')}>Pending</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.type}
              onClick={() => navigate({ to: '/jobs', search: { type: [r.type] } })}
              className="cursor-pointer"
            >
              <TableCell className="pl-4">
                <Link
                  to="/jobs"
                  search={{ type: [r.type] }}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  <span
                    aria-hidden
                    className="h-3 w-1 shrink-0 rounded-[1px]"
                    style={{ backgroundColor: typeColorVar(r.type) }}
                  />
                  {r.type}
                </Link>
              </TableCell>
              <TableCell className={NUM}>{formatNumber(r.finished)}</TableCell>
              <TableCell className={cn(NUM, toneClass[rateTone(r.successRate)])}>
                {formatPercent(r.successRate)}
              </TableCell>
              <TableCell className={NUM}>{ms(r.runP50Ms)}</TableCell>
              <TableCell className={NUM}>{ms(r.runP95Ms)}</TableCell>
              <TableCell className={NUM}>{ms(r.waitP95Ms)}</TableCell>
              <TableCell className={cn(NUM, 'pr-4')}>{formatNumber(r.pendingNow)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

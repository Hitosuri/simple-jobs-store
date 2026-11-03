import { useState, type CSSProperties } from 'react';
import JsonView from '@uiw/react-json-view';
import { ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { Json } from '@/api/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Copies text, falling back to a hidden textarea where the async clipboard API is missing. */
export async function copyText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  // navigator.clipboard only exists in secure contexts; the control room is served over plain http on the LAN.
  const area = document.createElement('textarea');
  area.value = text;
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy failed');
}

function summarize(value: Json): string {
  if (Array.isArray(value)) return `${value.length} items`;
  if (value !== null && typeof value === 'object') return `${Object.keys(value).length} keys`;
  return typeof value === 'string' ? 'text' : String(value);
}

const punctuation = 'color-mix(in oklab, var(--muted-foreground) 75%, transparent)';
const scalar = 'color-mix(in oklab, var(--type-1) 65%, var(--foreground))';

const THEME = {
  '--w-rjv-font-family': 'var(--font-mono, ui-monospace, monospace)',
  '--w-rjv-color': 'var(--foreground)',
  '--w-rjv-background-color': 'var(--inset)',
  '--w-rjv-line-color': 'var(--border)',
  '--w-rjv-arrow-color': 'var(--muted-foreground)',
  '--w-rjv-info-color': 'var(--muted-foreground)',
  '--w-rjv-key-string': 'var(--muted-foreground)',
  '--w-rjv-key-number': 'var(--muted-foreground)',
  '--w-rjv-curlybraces-color': punctuation,
  '--w-rjv-brackets-color': punctuation,
  '--w-rjv-colon-color': punctuation,
  '--w-rjv-quotes-color': punctuation,
  '--w-rjv-quotes-string-color': punctuation,
  '--w-rjv-ellipsis-color': 'var(--muted-foreground)',
  '--w-rjv-type-string-color': 'var(--foreground)',
  '--w-rjv-type-int-color': scalar,
  '--w-rjv-type-float-color': scalar,
  '--w-rjv-type-boolean-color': scalar,
  '--w-rjv-type-null-color': 'var(--muted-foreground)',
  '--w-rjv-type-url-color': 'var(--primary)',
  fontSize: 12,
} as CSSProperties;

export function JsonBlock({
  title,
  value,
  summary,
  defaultOpen = false,
}: {
  title: string;
  value: Json;
  summary?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const tree = value !== null && typeof value === 'object';

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9"
        >
          <ChevronRight
            aria-hidden
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
          {title}
          <span className="ml-auto min-w-0 truncate pl-2 text-xs font-normal text-muted-foreground">
            {summary ?? summarize(value)}
          </span>
        </button>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Copy ${title}`}
          onClick={() =>
            copyText(text).then(
              () => toast(`${title} copied`),
              () => toast.error('Could not copy'),
            )
          }
          className="max-md:size-11"
        >
          <Copy />
          <span className="max-md:sr-only">Copy</span>
        </Button>
      </div>
      {open && (
        <div className="max-h-80 overflow-auto rounded-b-lg border-t bg-inset p-3">
          {tree ? (
            <JsonView
              value={value}
              style={THEME}
              collapsed={2}
              displayDataTypes={false}
              enableClipboard={false}
              shortenTextAfterLength={120}
            />
          ) : (
            <pre className="font-mono text-xs break-words whitespace-pre-wrap">{text}</pre>
          )}
        </div>
      )}
    </section>
  );
}

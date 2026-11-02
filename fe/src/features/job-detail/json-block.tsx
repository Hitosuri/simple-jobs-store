import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { Json } from '@/api/types';
import { Button } from '@/components/ui/button';

async function copyText(text: string) {
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
  if (Array.isArray(value)) return `JSON · ${value.length} items`;
  if (value !== null && typeof value === 'object') return `JSON · ${Object.keys(value).length} keys`;
  return typeof value === 'string' ? 'text' : `JSON · ${String(value)}`;
}

export function JsonBlock({
  title,
  value,
  summary,
  defaultOpen,
}: {
  title: string;
  value: Json;
  summary?: string;
  defaultOpen?: boolean;
}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <details open={defaultOpen} className="group rounded-lg border bg-card">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[13px] font-semibold marker:content-none md:min-h-9">
        {title}
        <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
          {summary ?? summarize(value)}
          <span aria-hidden className="ml-1 inline-block transition-transform group-open:rotate-90">
            {'›'}
          </span>
        </span>
      </summary>
      <div className="relative border-t">
        <Button
          variant="outline"
          size="xs"
          aria-label={`Copy ${title}`}
          onClick={() =>
            copyText(text).then(
              () => toast(`${title} copied`),
              () => toast.error('Could not copy'),
            )
          }
          className="absolute top-2 right-2 max-md:size-11"
        >
          <Copy />
          <span className="max-md:sr-only">Copy</span>
        </Button>
        <pre className="max-h-64 overflow-auto bg-inset p-3 pr-20 font-mono text-xs break-words whitespace-pre-wrap">
          {text}
        </pre>
      </div>
    </details>
  );
}

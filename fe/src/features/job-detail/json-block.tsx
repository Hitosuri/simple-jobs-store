import type { Json } from '@/api/types';

function summarize(value: Json): string {
  if (Array.isArray(value)) return `JSON · ${value.length} items`;
  if (value !== null && typeof value === 'object') return `JSON · ${Object.keys(value).length} keys`;
  return typeof value === 'string' ? 'text' : `JSON · ${String(value)}`;
}

export function JsonBlock({ title, value, summary }: { title: string; value: Json; summary?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[13px] font-semibold marker:content-none md:min-h-9">
        {title}
        <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
          {summary ?? summarize(value)}
          <span aria-hidden className="ml-1 inline-block transition-transform group-open:rotate-90">
            {'›'}
          </span>
        </span>
      </summary>
      <pre className="max-h-64 overflow-auto border-t bg-inset p-3 font-mono text-xs break-words whitespace-pre-wrap">
        {text}
      </pre>
    </details>
  );
}

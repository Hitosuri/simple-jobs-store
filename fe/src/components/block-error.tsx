import { Button } from '@/components/ui/button';

const clock = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function BlockError({
  message,
  lastGoodAt,
  onRetry,
}: {
  message: string;
  lastGoodAt: number;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm">
      <p className="text-bad">{message}</p>
      <p className="text-xs text-muted-foreground">
        {lastGoodAt ? `Last good data at ${clock.format(lastGoodAt)}` : 'No data received yet'}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="max-md:min-h-11">
        Retry
      </Button>
    </div>
  );
}

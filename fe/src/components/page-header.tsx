import type { ReactNode } from 'react';
import { LiveIndicator } from '@/components/shell/live-indicator';
import { ThemeToggle } from '@/components/shell/theme-toggle';

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        <LiveIndicator className="lg:hidden" />
        <span className="lg:hidden">
          <ThemeToggle />
        </span>
      </div>
    </header>
  );
}

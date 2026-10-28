import { Link } from '@tanstack/react-router';
import { NAV_ITEMS } from './nav-items';
import { LiveIndicator } from './live-indicator';
import { ThemeToggle } from './theme-toggle';

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r bg-sidebar p-3 lg:flex">
      <div className="mb-3 flex items-center gap-2 px-2 py-1">
        <span aria-hidden className="size-5 rounded-md bg-primary" />
        <span className="text-sm font-semibold">simple-jobs-store</span>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === '/' }}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            activeProps={{ className: 'bg-primary/15 font-semibold text-primary hover:text-primary' }}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto flex items-center justify-between gap-2 px-1">
        <LiveIndicator />
        <ThemeToggle />
      </div>
    </aside>
  );
}

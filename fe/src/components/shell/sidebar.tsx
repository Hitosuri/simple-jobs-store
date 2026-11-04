import { Link } from '@tanstack/react-router';
import { NAV_ITEMS } from './nav-items';
import { LiveIndicator } from './live-indicator';
import { ThemeToggle } from './theme-toggle';

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r bg-sidebar p-3 lg:flex">
      <div className="mb-3 flex items-center gap-2 px-2 py-1">
        <svg aria-hidden viewBox="0 0 24 24" className="size-6 shrink-0">
          <rect width="24" height="24" rx="6" className="fill-primary" />
          <g className="fill-primary-foreground">
            <rect x="5" y="6" width="11" height="3" rx="1.5" />
            <rect x="8" y="10.5" width="11" height="3" rx="1.5" />
            <rect x="5" y="15" width="11" height="3" rx="1.5" />
          </g>
        </svg>
        <span className="text-[15px] font-semibold tracking-tight">Jobs Store</span>
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

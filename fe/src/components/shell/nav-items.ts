import { Activity, BarChart3, ListChecks, Server } from 'lucide-react';

export const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: Activity },
  { to: '/jobs', label: 'Jobs', icon: ListChecks },
  { to: '/machines', label: 'Machines', icon: Server },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
] as const;

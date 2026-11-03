import { createRootRoute, Outlet } from '@tanstack/react-router';
import { BottomTabs } from '@/components/shell/bottom-tabs';
import { Sidebar } from '@/components/shell/sidebar';
import { StaleBar } from '@/components/shell/stale-bar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from '@/lib/theme';

function RootLayout() {
  useTheme();
  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:has-[[data-fill-viewport]]:h-dvh lg:p-6 lg:pb-6">
          <StaleBar />
          <Outlet />
        </main>
      </div>
      <BottomTabs />
      <Toaster />
    </TooltipProvider>
  );
}

export const Route = createRootRoute({ component: RootLayout });

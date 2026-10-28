import { createRootRoute, Outlet } from '@tanstack/react-router';
import { BottomTabs } from '@/components/shell/bottom-tabs';
import { Sidebar } from '@/components/shell/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from '@/lib/theme';

function RootLayout() {
  useTheme();
  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))]lg:p-6 lg:pb-6">
          <Outlet />
        </main>
      </div>
      <BottomTabs />
      <Toaster />
    </TooltipProvider>
  );
}

export const Route = createRootRoute({ component: RootLayout });

import { createFileRoute, Outlet } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';

export const Route = createFileRoute('/machines')({
  component: () => (
    <>
      <PageHeader title="Machines" />
      <Outlet />
    </>
  ),
});

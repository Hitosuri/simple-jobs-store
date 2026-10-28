import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { WorkerDrawer } from '@/features/machines/worker-drawer';

function WorkerRoute() {
  const { workerId } = Route.useParams();
  const navigate = useNavigate();
  return (
    <WorkerDrawer
      workerId={workerId}
      onClose={() => navigate({ from: '/machines/$workerId', to: '/machines', search: (prev) => prev })}
    />
  );
}

export const Route = createFileRoute('/machines/$workerId')({ component: WorkerRoute });

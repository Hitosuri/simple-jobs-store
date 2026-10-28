import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { JobDetail } from '@/features/job-detail/job-detail';

function JobDetailRoute() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  return <JobDetail id={Number(jobId)} onClose={() => navigate({ to: '/jobs', search: (prev) => prev })} />;
}

export const Route = createFileRoute('/jobs/$jobId')({ component: JobDetailRoute });

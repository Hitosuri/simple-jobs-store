import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';

export const Route = createFileRoute('/stats')({ component: () => <PageHeader title="Stats" /> });

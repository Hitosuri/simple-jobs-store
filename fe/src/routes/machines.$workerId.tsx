import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/machines/$workerId')({ component: () => <p>Machine detail</p> });

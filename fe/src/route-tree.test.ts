import { expect, test } from 'vitest';
import { routeTree } from './routeTree.gen';

test('route tree contains the index route', () => {
  expect(Object.values(routeTree.children ?? {}).map((route) => route.options.path)).toContain('/');
});

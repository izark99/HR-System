import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { FlowListPage } from '../features/runner/FlowListPage';
import { RunPage } from '../features/runner/RunPage';
import { AppShell } from './AppShell';

const rootRoute = createRootRoute({ component: AppShell });

const flowListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: FlowListPage,
});

export const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/run/$flowCode',
  component: RunPage,
});

export const resultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/run/$flowCode/result',
  // TanStack Table + Virtual are only needed here: keep them out of the entry chunk.
  component: lazyRouteComponent(() => import('../features/runner/ResultPage'), 'ResultPage'),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([flowListRoute, runRoute, resultRoute]),
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

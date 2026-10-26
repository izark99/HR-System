import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { FlowListPage } from '../features/runner/FlowListPage';
import { RunPage } from '../features/runner/RunPage';
import { RootLayout } from './RootLayout';

// Auth guard + layout choice live in RootLayout (pure rules in features/auth/guard.ts).
const rootRoute = createRootRoute({ component: RootLayout });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change-password',
  component: ChangePasswordPage,
});

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

// Admin area: its own chunk (Admins only; the guard redirects everyone else).
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: lazyRouteComponent(() => import('../features/admin/AdminLayout'), 'AdminLayout'),
});

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router API
    throw redirect({ to: '/admin/users', replace: true });
  },
});

const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  component: lazyRouteComponent(() => import('../features/admin/AdminUsersPage'), 'AdminUsersPage'),
});

const adminFlowsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/flows',
  component: lazyRouteComponent(() => import('../features/admin/AdminFlowsPage'), 'AdminFlowsPage'),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    loginRoute,
    changePasswordRoute,
    flowListRoute,
    runRoute,
    resultRoute,
    adminRoute.addChildren([adminIndexRoute, adminUsersRoute, adminFlowsRoute]),
  ]),
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

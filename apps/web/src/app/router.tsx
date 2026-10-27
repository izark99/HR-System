import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { waitForAuth, type AuthService } from '../features/auth/auth-service';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { resolveGuard } from '../features/auth/guard';
import { LoginPage } from '../features/auth/LoginPage';
import { FlowListPage } from '../features/runner/FlowListPage';
import { RunPage } from '../features/runner/RunPage';
import { RootLayout } from './RootLayout';

export interface RouterContext {
  /** Set by <App> (null only before the provider renders). */
  auth: AuthService | null;
}

// Auth guard + layout choice live in RootLayout (pure rules in features/auth/guard.ts).
const rootRoute = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

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

// Admin area: its own chunks (Admins only). The guard runs in `beforeLoad` too, so a User (or a
// signed-out visitor) is redirected before the router fetches any admin chunk (AC-B3-92);
// RootLayout applies the same rules for rendering.
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: async ({ context, location }) => {
    if (!context.auth) return;
    const state = await waitForAuth(context.auth);
    const decision = resolveGuard(location.pathname, state, location.searchStr);
    if (decision.kind === 'redirect') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router API
      throw redirect({ href: decision.href, replace: true });
    }
  },
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

export const flowVersionsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/flows/$flowCode/versions',
  component: lazyRouteComponent(
    () => import('../features/admin/versions/FlowVersionsPage'),
    'FlowVersionsPage',
  ),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    loginRoute,
    changePasswordRoute,
    flowListRoute,
    runRoute,
    resultRoute,
    adminRoute.addChildren([adminIndexRoute, adminUsersRoute, adminFlowsRoute, flowVersionsRoute]),
  ]),
  defaultPreload: false,
  context: { auth: null },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

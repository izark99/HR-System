import { LocalAuth, SupabaseAuth, type AuthService } from '../features/auth/auth-service';
import type { FlowSource } from '../features/runner/flow-source';
import type { RunLogger } from '../features/runner/run-log';
import { SupabaseFlowSource } from '../features/runner/supabase-flow-source';
import { appConfig } from '../lib/env';
import { browserSessionStorage, clearSessionAfterIdle, getSupabase } from '../lib/supabase';
import { createHttpRevoker } from '../features/auth/session-revoke';
import { loadTextOverrides } from '../lib/ui-text';

export interface AppServices {
  auth: AuthService;
  source: FlowSource;
  logger: RunLogger | null;
  /** Texts edited by Admins loaded (or given up on: defaults stay), spec §33 AC-TX-05. */
  ready?: Promise<unknown>;
}

/** Bundled flows, loaded on demand so the fixture never reaches the production bundle. */
function lazyLocalSource(): FlowSource {
  const load = () => import('../features/runner/local-flow-source').then((m) => m.localFlowSource);
  return {
    list: (asOf) => load().then((s) => s.list(asOf)),
    get: (code, asOf) => load().then((s) => s.get(code, asOf)),
  };
}

export function createServices(): AppServices | null {
  // `import.meta.env.PROD` is a build-time constant: the local branch is removed from production
  // builds, so no env flag can turn off authentication there.
  if (!import.meta.env.PROD && appConfig.mode === 'local') {
    return { auth: new LocalAuth(), source: lazyLocalSource(), logger: null };
  }
  if (appConfig.mode !== 'supabase') return null;
  clearSessionAfterIdle(
    typeof window !== 'undefined' ? window.location : null,
    browserSessionStorage(),
  );
  const sb = getSupabase();
  const source = new SupabaseFlowSource(sb);
  const revoker = createHttpRevoker(appConfig.supabaseUrl, appConfig.supabaseKey);
  return {
    auth: new SupabaseAuth(sb, browserSessionStorage(), revoker),
    source,
    logger: source,
    ready: loadTextOverrides(sb),
  };
}

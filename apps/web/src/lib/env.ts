/**
 * Runtime configuration from Vite env (build time). Values are public: the URL and the
 * publishable ("anon") key are meant to ship to the browser; the service role key never is.
 */

export type AppConfig =
  | { mode: 'supabase'; supabaseUrl: string; supabaseKey: string }
  /** Dev/test only: bundled flows, no login, no server. Impossible in a production build. */
  | { mode: 'local' }
  | { mode: 'misconfigured' };

export interface EnvInput {
  PROD: boolean;
  VITE_SUPABASE_URL?: string | undefined;
  VITE_SUPABASE_ANON_KEY?: string | undefined;
  VITE_FLOW_SOURCE?: string | undefined;
}

export function resolveConfig(env: EnvInput): AppConfig {
  // Guarded by PROD so a production build can never be switched to "no auth" by an env flag.
  if (!env.PROD && env.VITE_FLOW_SOURCE === 'local') return { mode: 'local' };
  const url = env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '') ?? '';
  const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)
  ) {
    return { mode: 'misconfigured' };
  }
  // A service role / secret key in a client env file would bypass RLS: refuse to use it.
  if (!key || /^sb_secret_/.test(key) || jwtRole(key) === 'service_role') {
    return { mode: 'misconfigured' };
  }
  return { mode: 'supabase', supabaseUrl: url, supabaseKey: key };
}

function jwtRole(key: string): string | null {
  const payload = key.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: unknown;
    };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

export const appConfig: AppConfig = resolveConfig({
  PROD: import.meta.env.PROD,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_FLOW_SOURCE: import.meta.env.VITE_FLOW_SOURCE,
});

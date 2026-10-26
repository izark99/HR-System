/**
 * Daily keep-alive for the Supabase Free project (paused after 7 days without activity).
 * One tiny REST query with the publishable key: `app_settings` grants SELECT to anon but RLS
 * returns no rows, so nothing is exposed and the request still reaches Postgres.
 * No secrets here, no data read.
 */

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function pingUrl(env: Env): string {
  return `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/app_settings?select=key&limit=1`;
}

/** Throws when Supabase does not answer 2xx, so the failure shows up in the Cron logs. */
export async function ping(env: Env, fetchFn: typeof fetch = fetch): Promise<number> {
  const res = await fetchFn(pingUrl(env), {
    method: 'GET',
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' },
  });
  // Drain the (empty) body so the connection is released.
  await res.text();
  if (!res.ok) throw new Error(`keep-alive ping failed: HTTP ${res.status}`);
  return res.status;
}

export default {
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(ping(env));
  },
};

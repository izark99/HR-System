/**
 * Deno entry of the admin-users Edge Function.
 *
 * Env (Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY automatically):
 *   ALLOWED_ORIGINS  comma-separated exact origins of the web app, e.g.
 *                    "https://hr-data-flow.pages.dev,http://localhost:5173"
 */
import { createBackend } from './backend.ts';
import { handleRequest, parseAllowedOrigins } from './handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

/** New-style secret keys are exposed as a JSON map; fall back to the legacy service role key. */
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

const url = Deno.env.get('SUPABASE_URL') ?? '';
const backend = createBackend(url, serviceKey());
// Origins are not secret: default to the production app so no dashboard secret is required.
const DEFAULT_ALLOWED_ORIGINS = 'https://hr-data-flow.pages.dev';
const env = {
  allowedOrigins: parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS') ?? DEFAULT_ALLOWED_ORIGINS),
};

Deno.serve((req) => handleRequest(req, env, backend));

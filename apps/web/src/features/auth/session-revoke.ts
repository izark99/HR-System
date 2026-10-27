/**
 * Server-side revocation for the idle sign-out (spec §6.1, MEMORY 2026-10-27 12:30): after 8 idle
 * hours the stored access token is usually expired (a hidden tab or a sleeping laptop stops the
 * auto-refresh), and `/logout` with an expired JWT answers 401 without revoking anything. So:
 * 1. access token still valid → `POST /logout?scope=local`;
 * 2. expired (JWT `exp` / `expires_at` passed) or `/logout` says 401 → exchange the refresh token
 *    once (`POST /token?grant_type=refresh_token`) and log out with the new access token.
 * `scope=local` ends this session (all its refresh tokens), not the account's other sessions.
 *
 * Tokens only travel in request headers/bodies to the Supabase origin: never logged, never stored
 * (the refreshed session is not written back to storage). The caller bounds the time (3 s).
 */

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string | null;
  /** Epoch seconds, from the stored session (falls back to the JWT `exp`). */
  expiresAt: number | null;
}

export type LogoutResult = 'ok' | 'unauthorized' | 'failed';

export interface SessionRevoker {
  /** New access token for the refresh token, or null (refused, offline, …). */
  refresh(refreshToken: string): Promise<string | null>;
  logout(accessToken: string): Promise<LogoutResult>;
}

/** Margin so a token expiring during the request counts as expired. */
const EXPIRY_SKEW_S = 10;

function jwtExp(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** Tokens of the stored supabase-js session (`hrflow.auth`), read synchronously. */
export function parseStoredTokens(raw: string | null | undefined): StoredTokens {
  const none: StoredTokens = { accessToken: null, refreshToken: null, expiresAt: null };
  if (!raw) return none;
  try {
    const s = JSON.parse(raw) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_at?: unknown;
    };
    const accessToken =
      typeof s.access_token === 'string' && s.access_token ? s.access_token : null;
    return {
      accessToken,
      refreshToken: typeof s.refresh_token === 'string' && s.refresh_token ? s.refresh_token : null,
      expiresAt:
        typeof s.expires_at === 'number' ? s.expires_at : accessToken ? jwtExp(accessToken) : null,
    };
  } catch {
    return none;
  }
}

export function isExpired(tokens: StoredTokens, nowMs: number): boolean {
  return tokens.expiresAt === null || tokens.expiresAt - EXPIRY_SKEW_S <= nowMs / 1000;
}

/** Revoke this session; resolves to whether the server confirmed it. Never rejects. */
export async function revokeSession(
  tokens: StoredTokens,
  revoker: SessionRevoker,
  nowMs: number = Date.now(),
): Promise<boolean> {
  try {
    let refreshed = false;
    const refresh = async (): Promise<string | null> => {
      if (refreshed || !tokens.refreshToken) return null;
      refreshed = true;
      return revoker.refresh(tokens.refreshToken);
    };
    let access = tokens.accessToken && !isExpired(tokens, nowMs) ? tokens.accessToken : null;
    if (!access) access = await refresh();
    if (!access) return false;
    let result = await revoker.logout(access);
    if (result === 'unauthorized') {
      const fresh = await refresh();
      if (!fresh) return false;
      result = await revoker.logout(fresh);
    }
    return result === 'ok';
  } catch {
    return false;
  }
}

/** Plain-fetch revoker against the project (publishable key only). */
export function createHttpRevoker(
  supabaseUrl: string,
  publishableKey: string,
  fetcher: typeof fetch = (...a) => fetch(...a),
): SessionRevoker {
  const base = `${supabaseUrl}/auth/v1`;
  return {
    async refresh(refreshToken) {
      try {
        const res = await fetcher(`${base}/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: publishableKey, 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return null;
        const token = ((await res.json()) as { access_token?: unknown }).access_token;
        return typeof token === 'string' && token ? token : null;
      } catch {
        return null;
      }
    },
    async logout(accessToken) {
      try {
        const res = await fetcher(`${base}/logout?scope=local`, {
          method: 'POST',
          headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) return 'ok';
        return res.status === 401 ? 'unauthorized' : 'failed';
      } catch {
        return 'failed';
      }
    },
  };
}

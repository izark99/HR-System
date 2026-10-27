import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { appConfig } from './env';

export type Supabase = SupabaseClient<Database>;

/**
 * Session in sessionStorage (not localStorage): it ends with the tab, like the in-memory files
 * and results, and is not shared with other tabs. Only Supabase auth tokens are stored there,
 * never file content.
 */
export const AUTH_STORAGE_KEY = 'hrflow.auth';

export function createSupabase(url: string, key: string, storage?: Storage): Supabase {
  return createClient<Database>(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
      ...(storage ? { storage } : {}),
    },
  });
}

/** Remove the stored session (and supabase-js side keys such as `<key>-code-verifier`). */
export function clearStoredSession(storage: Storage | null): void {
  if (!storage) return;
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key === AUTH_STORAGE_KEY || key?.startsWith(`${AUTH_STORAGE_KEY}-`)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // storage unavailable: nothing stored either
  }
}

/** The stored session JSON (null when absent/unreadable), read synchronously. */
export function readStoredSession(storage: Storage | null): string | null {
  try {
    return storage?.getItem(AUTH_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The tab's sessionStorage, or null outside a browser. */
export function browserSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

let client: Supabase | null = null;

/** The app-wide client; only available when the app runs against Supabase. */
export function getSupabase(): Supabase {
  if (appConfig.mode !== 'supabase') throw new Error('Supabase is not configured');
  client ??= createSupabase(
    appConfig.supabaseUrl,
    appConfig.supabaseKey,
    typeof window !== 'undefined' ? window.sessionStorage : undefined,
  );
  return client;
}

/**
 * The forced sign-out after 8 hours (spec §6.1, MEMORY 2026-10-27 12:30), as a plain function so
 * its order and timing are unit-tested:
 * 1. unsaved-changes prompt released and every engine worker terminated, immediately;
 * 2. `signOut('idle')` started (scope local: it drops the stored session synchronously, then asks
 *    the server to revoke this session's refresh token);
 * 3. the stored session is cleared again (belt and braces, e.g. LocalAuth or an unexpected error);
 * 4. at most `timeoutMs` (3 s) waited for the server, then the login page is loaded regardless.
 */

export const IDLE_SIGN_OUT_WAIT_MS = 3000;

export interface IdleSignOutDeps {
  signOut: () => Promise<void>;
  disposeEngines: () => void;
  releaseUnsavedGuard: () => void;
  clearSession: () => void;
  redirect: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  timeoutMs?: number;
}

export async function idleSignOut(deps: IdleSignOutDeps): Promise<void> {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  deps.releaseUnsavedGuard();
  deps.disposeEngines();
  let request: Promise<void>;
  try {
    request = deps.signOut().catch(() => undefined);
  } catch {
    request = Promise.resolve();
  }
  deps.clearSession();
  await Promise.race([
    request,
    new Promise<void>((resolve) => {
      setTimer(resolve, deps.timeoutMs ?? IDLE_SIGN_OUT_WAIT_MS);
    }),
  ]);
  deps.clearSession();
  deps.redirect();
}

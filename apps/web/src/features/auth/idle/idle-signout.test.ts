/** Forced idle sign-out sequence (spec §6.1, MEMORY 2026-10-27 12:30, AC-B3-82). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_SIGN_OUT_WAIT_MS, idleSignOut } from './idle-signout';

function deps(signOut: () => Promise<void>) {
  const log: string[] = [];
  return {
    log,
    d: {
      signOut: vi.fn(() => {
        log.push('signOut');
        return signOut();
      }),
      disposeEngines: vi.fn(() => log.push('disposeEngines')),
      releaseUnsavedGuard: vi.fn(() => log.push('releaseUnsavedGuard')),
      clearSession: vi.fn(() => log.push('clearSession')),
      redirect: vi.fn(() => log.push('redirect')),
    },
  };
}

describe('idleSignOut', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('engines and session go at once; a server that never answers delays the redirect 3 s, no more', async () => {
    const { d, log } = deps(() => new Promise<void>(() => undefined));
    const done = idleSignOut(d);
    // Synchronous part: prompt released, workers terminated, sign-out started, session cleared.
    expect(log).toEqual(['releaseUnsavedGuard', 'disposeEngines', 'signOut', 'clearSession']);
    expect(d.disposeEngines).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDLE_SIGN_OUT_WAIT_MS - 1);
    expect(d.redirect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(d.redirect).toHaveBeenCalledTimes(1);
    expect(IDLE_SIGN_OUT_WAIT_MS).toBe(3000);
  });

  it('a fast server answer redirects right away', async () => {
    const { d } = deps(() => Promise.resolve());
    await idleSignOut(d);
    expect(d.redirect).toHaveBeenCalledTimes(1);
    expect(d.clearSession).toHaveBeenCalledTimes(2);
  });

  it('a failing or throwing sign-out still ends on the login page', async () => {
    const rejecting = deps(() => Promise.reject(new Error('offline')));
    await idleSignOut(rejecting.d);
    expect(rejecting.d.redirect).toHaveBeenCalledTimes(1);

    const throwing = deps(() => {
      throw new Error('sync');
    });
    await idleSignOut(throwing.d);
    expect(throwing.d.redirect).toHaveBeenCalledTimes(1);
    expect(throwing.d.disposeEngines).toHaveBeenCalledTimes(1);
  });
});

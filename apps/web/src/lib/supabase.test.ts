import { describe, expect, it } from 'vitest';
import { AUTH_STORAGE_KEY, clearSessionAfterIdle } from './supabase';

function memoryStorage(entries: Record<string, string>): Storage {
  const store = new Map(Object.entries(entries));
  return {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe('clearSessionAfterIdle', () => {
  const stored = () =>
    memoryStorage({ [AUTH_STORAGE_KEY]: '{}', [`${AUTH_STORAGE_KEY}-code-verifier`]: 'x', o: '1' });

  it('drops the stored session when booting on /login?reason=idle', () => {
    const s = stored();
    expect(clearSessionAfterIdle({ pathname: '/login', search: '?reason=idle' }, s)).toBe(true);
    expect(s.length).toBe(1);
    expect(s.getItem('o')).toBe('1');
  });

  it('keeps the session anywhere else', () => {
    for (const loc of [
      { pathname: '/login', search: '' },
      { pathname: '/login', search: '?reason=signedOut' },
      { pathname: '/flows', search: '?reason=idle' },
    ]) {
      const s = stored();
      expect(clearSessionAfterIdle(loc, s)).toBe(false);
      expect(s.length).toBe(3);
    }
    expect(clearSessionAfterIdle(null, stored())).toBe(false);
  });
});

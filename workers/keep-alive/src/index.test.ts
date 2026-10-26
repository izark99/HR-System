import { describe, expect, it, vi } from 'vitest';
import worker, { ping, pingUrl, type Env } from './index';

const env: Env = {
  SUPABASE_URL: 'https://example-ref.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

describe('keep-alive worker', () => {
  it('pings one cheap REST query with the publishable key only', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })));
    await expect(ping(env, fetchFn as unknown as typeof fetch)).resolves.toBe(200);
    expect(pingUrl(env)).toBe(
      'https://example-ref.supabase.co/rest/v1/app_settings?select=key&limit=1',
    );
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(pingUrl(env));
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ apikey: 'sb_publishable_test', Accept: 'application/json' });
    expect(JSON.stringify(init)).not.toMatch(/authorization|service_role|sb_secret/i);
  });

  it('fails loudly on a non-2xx answer', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('', { status: 503 })));
    await expect(ping(env, fetchFn as unknown as typeof fetch)).rejects.toThrow('HTTP 503');
  });

  it('scheduled() hands the ping to waitUntil', () => {
    const waitUntil = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    worker.scheduled({ scheduledTime: 0, cron: '0 1 * * *' }, env, { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

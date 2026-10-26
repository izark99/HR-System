/**
 * Playwright `test` with a mocked Supabase (e2e/supabase-mock.ts) installed for every test.
 * By default the page starts signed in as the fake User `hr.nv01` (assigned to the acceptance
 * flow), so the runner specs exercise the production build exactly as before. Use
 * `test.use({ signedInAs: null })` for login tests, or `ADMIN` for admin screens.
 */
import { expect, test as base } from '@playwright/test';
import { SupabaseMock, USER, type MockUser } from './supabase-mock';

export { expect };
export type { Locator, Page } from '@playwright/test';
export { ADMIN, SUPABASE_ORIGIN, USER } from './supabase-mock';

export const test = base.extend<{ supabase: SupabaseMock; signedInAs: MockUser | null }>({
  signedInAs: [USER, { option: true }],
  supabase: [
    async ({ page, signedInAs }, use) => {
      const mock = new SupabaseMock();
      await mock.install(page.context());
      if (signedInAs) await mock.signInAs(page, signedInAs);
      await use(mock);
      // Every request to the Supabase origin must have been an endpoint the mock knows.
      expect(mock.unhandled, 'unmocked Supabase requests').toEqual([]);
    },
    { auto: true },
  ],
});

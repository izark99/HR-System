import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Headers of the `/*` block in public/_headers (Cloudflare Pages format), so `vite preview` —
 * used by the E2E tests — serves the same CSP as production.
 */
function pagesHeaders(): Record<string, string> {
  const lines = readFileSync(resolve(import.meta.dirname, 'public/_headers'), 'utf8').split('\n');
  const headers: Record<string, string> = {};
  let inBlock = false;
  for (const line of lines) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      inBlock = line.trim() === '/*';
      continue;
    }
    const i = line.indexOf(':');
    if (inBlock && i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  // HSTS on localhost would pin http://localhost to https in the test browser profile.
  delete headers['Strict-Transport-Security'];
  return headers;
}

/**
 * `vite build --mode e2e`: production build pointed at the real project URL (the only Supabase
 * origin the CSP allows) with a FAKE publishable key. Playwright intercepts every request to that
 * origin (e2e/supabase-mock.ts), so E2E never reaches the real project.
 */
const E2E_ENV = {
  'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://rzakjtgvbyxqsmbpcomw.supabase.co'),
  'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('sb_publishable_e2e_fake_key'),
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: mode === 'e2e' ? E2E_ENV : {},
  build: {
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  preview: {
    headers: pagesHeaders(),
  },
  test: {
    // Engine is pure TS and must run in Node (no DOM).
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
  },
}));

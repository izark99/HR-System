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

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
});

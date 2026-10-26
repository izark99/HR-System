# keep-alive (Cloudflare Cron Worker)

Supabase Free pauses a project after 7 days without activity (spec §16). This Worker sends one
cheap request per day:

```
GET https://<ref>.supabase.co/rest/v1/app_settings?select=key&limit=1
apikey: <publishable key>
```

`app_settings` is readable by `anon` at the privilege level, but RLS returns no rows to `anon`,
so the response is `[]` and nothing is exposed. The Worker holds no secret: the publishable key
is the same public value the web app ships with.

## Deploy (one time)

Requirements: a Cloudflare account (free plan is enough) and Node ≥ 22.

```bash
cd workers/keep-alive
npx wrangler@4 login          # opens the browser, authorise Wrangler
npx wrangler@4 deploy         # uploads src/index.ts with the cron trigger from wrangler.toml
```

Check: Cloudflare dashboard → Workers & Pages → `hrflow-keep-alive` → Settings → Triggers shows
`0 1 * * *` (08:00 Vietnam time). The *Logs* tab shows each run; a failed ping throws
`keep-alive ping failed: HTTP <status>`.

Manual test without waiting for the cron:

```bash
npx wrangler@4 dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+1+*+*+*"
```

If the Supabase project ref or publishable key changes, update `[vars]` in `wrangler.toml` and
deploy again.

## Tests

`pnpm --filter @hrflow/keep-alive test` (Vitest, no network: `fetch` is mocked).

# ADR-002 — Product scope and data boundary stay as they are

Status: Accepted · 2026-11-13 (owner answer 2A, 4A)

## Context

The redesign brief mentioned headcount, C&B, budget and reporting as possible purposes. Building
those would mean storing employee and compensation data on a server.

## Options

| Option | Effect |
|--------|--------|
| A. Keep: Excel flow platform, all file content processed in the browser, server holds metadata only | No change to privacy posture; free hosting remains viable |
| B. Add reports/charts computed in the browser from uploaded files | Same boundary; more engine and UI work |
| C. Store HR data server-side (HRIS-like) | Reverses the 2026-10-26 decisions and `data-privacy` rules; needs access control and audit for personal and pay data, legal review, and is no longer a personal experiment |

## Decision

**Option A.** Two roles (`admin`, `user`); ≤ 6 people in the next 6 months. Option B is possible
later through `output.chart` without changing this ADR. Option C is out of scope.

## Consequences

- Non-negotiable rule kept: file content never leaves the browser (not uploaded, not logged, not stored).
- The data model has no employee or compensation entity (`../03-domain-and-data-model.md`); "audit logging for compensation data" is not applicable.
- No backend service is added. Supabase Free + Cloudflare Pages stay.
- CSP `connect-src` stays limited to the app origin, the Supabase project and `blob:`.

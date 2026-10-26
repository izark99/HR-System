# CLAUDE.md — HR Data Flow Platform

Webapp nội bộ xử lý dữ liệu Excel **trực tiếp trên trình duyệt** theo các flow do Admin cấu hình. Người dùng chính: Harold (HR Analytics).

## Nguồn sự thật

1. `docs/MEMORY.md`: các quyết định đã chốt, **thắng mọi giả định**.
2. `docs/spec.md`: đặc tả chi tiết (kiến trúc, data model, node, design system §25).
3. Code hiện có.

Yêu cầu mới mâu thuẫn với MEMORY.md/spec.md → dừng, nêu mâu thuẫn, hỏi Harold.

@docs/MEMORY.md

## Quy tắc chi tiết (`.claude/rules/`)

| File | Nội dung | Nạp khi |
|------|----------|---------|
| `communication.md` | Cách trao đổi với Harold, câu hỏi A/B/C | Luôn luôn |
| `decision-log.md` | Cách ghi/sửa `docs/MEMORY.md` | Luôn luôn |
| `data-privacy.md` | Nguyên tắc dữ liệu & bảo mật bất di bất dịch | Luôn luôn |
| `workflow.md` | Team agent và quy trình làm 1 tính năng | Luôn luôn |
| `git.md` | Commit, secrets, tên công ty | Luôn luôn |
| `engine.md` | Engine, node plugin, worker, decimal | Khi làm trong `apps/web/src/engine/**`, `packages/flow-schema/**` |
| `frontend.md` | UI, design system, i18n, a11y | Khi làm trong `apps/web/src/**/*.tsx`, `*.css` |
| `testing.md` | Unit, E2E, dữ liệu giả, test nặng | Khi làm với file test, `e2e/**`, `fixtures/**` |

## Stack

TypeScript strict · React 19 · Vite · Tailwind v4 · TanStack Router/Table/Virtual · Zod · big.js · SheetJS CE (vendored) · ExcelJS · Comlink · i18next · Vitest · Playwright. Sắp tới: Supabase, DuckDB-WASM, React Flow, Pyodide. pnpm workspace, cấu trúc theo `docs/spec.md` §19.

## Lệnh

Node ≥ 22, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev              # chạy app (apps/web)
pnpm lint             # ESLint
pnpm format:check     # Prettier (pnpm format để sửa)
pnpm typecheck
pnpm test             # Vitest
pnpm build
pnpm test:e2e         # Playwright (build + preview)
pnpm --filter @hrflow/web test -- excel-reader   # chạy 1 file test
```

Trước khi báo xong hoặc commit: lint, format:check, typecheck, test, build (và test:e2e nếu đụng UI/worker) đều phải pass.

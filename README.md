# HR Data Flow Platform

Webapp nội bộ xử lý dữ liệu Excel **trực tiếp trên trình duyệt**. Admin cấu hình các flow xử lý (đối chiếu, gộp file, tổng hợp báo cáo…) bằng giao diện, không cần code; User chỉ cần chọn flow, upload file, chạy và tải kết quả về.

> **Dữ liệu nhân sự không rời máy người dùng.** File Excel được đọc và xử lý trong Web Worker của trình duyệt; server chỉ lưu tài khoản, cấu hình flow và log metadata.

## Trạng thái

Đang ở **Phase 1 (MVP)**, flow nghiệm thu là *Đối chiếu bảng lương – chấm công*.

| Hạng mục | Trạng thái |
|----------|-----------|
| Đặc tả, nhật ký quyết định, design system | ✅ `docs/` |
| Engine: đọc Excel theo input slot, validation, node `control.compare`, xuất Excel nhiều sheet | ✅ có test (khớp `fixtures/payroll-timesheet/expected.json`) |
| DAG executor + Web Worker + 3 màn hình User | ✅ |
| Supabase: đăng nhập, đổi mật khẩu lần đầu, RLS, flow/version theo ngày hiệu lực, run log metadata, Admin Users & Groups, nhập flow JSON | ✅ (bước 2) |
| Flow Designer cho Admin | ⏳ sau đó |
| Python (Pyodide), template Excel | Phase 2 |

Wireframe giao diện: https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (link riêng tư, cần được chia sẻ mới xem được).

## Kiến trúc tóm tắt

```
Trình duyệt ─ React SPA (UI)
             └ Web Worker: SheetJS (đọc) → engine (validate, compare…) → ExcelJS (ghi)
                   ▲ file Excel không bao giờ upload
Supabase ──── chỉ metadata: auth, flow/version, bảng tham chiếu không chứa dữ liệu cá nhân, log
Cloudflare ── host SPA (Pages, deploy từ main)
GitHub ───── CI + Actions theo lịch giữ Supabase không bị pause
```

Chi tiết: [`docs/spec.md`](docs/spec.md).

## Cấu trúc thư mục

```
apps/web/              React SPA + engine (src/engine: core, io, nodes)
packages/flow-schema/  Zod schema cho flow, input slot, cấu hình node (+ migrate.ts: tương thích schema)
supabase/
  migrations/          Schema, RLS, RPC (SQL thuần, áp dụng theo thứ tự tên file)
  tests/rls.sql        Kiểm thử RLS (chạy trong BEGIN … ROLLBACK, in "RLS OK")
  functions/admin-users/  Edge Function quản lý tài khoản (Deno; test bằng Vitest)
  seed/create_first_admin.sql  Tạo Admin đầu tiên (chạy 1 lần)

fixtures/              Dữ liệu GIẢ cho kiểm thử (+ script sinh dữ liệu)
vendor/                Thư viện vendored (SheetJS CE), có checksum
docs/
  spec.md              Đặc tả hệ thống
  MEMORY.md            Nhật ký quyết định (YYYY-MM-DD HH:MM - Quyết định)
.claude/agents/        Subagent: developer (làm), verifier (kiểm)
.claude/skills/        Skill: clarify (làm rõ yêu cầu, chạy trong session chính)
.claude/rules/         Quy tắc chi tiết cho Claude (giao tiếp, dữ liệu, engine, frontend, test…)
CLAUDE.md              Hướng dẫn làm việc cho Claude trên dự án
```

## Bắt đầu

Yêu cầu: Node ≥ 22, pnpm 10 (`corepack enable`).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # URL + publishable key của Supabase
pnpm dev            # chạy app (Vite)
pnpm test:e2e       # Playwright (build --mode e2e + preview; Supabase được mock hoàn toàn)
pnpm lint           # ESLint
pnpm typecheck      # TypeScript
pnpm test           # Vitest (engine chạy được trong Node)
pnpm build
pnpm format:check   # Prettier (CI dùng)
```

Sinh lại dữ liệu mẫu (cần Python 3 + openpyxl):

```bash
python3 fixtures/payroll-timesheet/generate.py
```

CI (GitHub Actions) chạy install → lint → format:check → typecheck → test → build trên mỗi push/PR.

### Biến môi trường (apps/web)

| Biến | Giá trị | Ghi chú |
|------|---------|---------|
| `VITE_SUPABASE_URL` | `https://rzakjtgvbyxqsmbpcomw.supabase.co` | Phải khớp `connect-src` trong `apps/web/public/_headers` |
| `VITE_SUPABASE_ANON_KEY` | publishable key `sb_publishable_…` | Công khai được. **Không bao giờ** dùng service role / secret key (app từ chối chạy) |
| `VITE_FLOW_SOURCE` | `local` (tùy chọn) | Chỉ khi dev: flow mẫu đóng gói sẵn, không đăng nhập. Bị bỏ qua ở bản production |

Thiếu biến khi build → app hiện màn "Ứng dụng chưa được cấu hình" (build vẫn thành công).

## Supabase (một lần khi dựng môi trường)

1. **Migrations**: chạy lần lượt `supabase/migrations/*.sql` theo thứ tự tên file (SQL editor hoặc `psql`).
2. **Kiểm thử RLS**: chạy `supabase/tests/rls.sql` (tự rollback); kết quả cuối phải là `RLS OK`.
   Không có Supabase? Chạy trên PostgreSQL ≥ 15 thường: nạp `supabase/tests/support/supabase_stub.sql` trước (chỉ dùng local).
3. **Edge Function `admin-users`**: deploy 4 file trong `supabase/functions/admin-users/` (`index.ts`, `handler.ts`, `backend.ts`, `deno.json`). `ALLOWED_ORIGINS` (tùy chọn, mặc định `https://hr-data-flow.pages.dev`) = các origin của app, cách nhau dấu phẩy (VD `https://<tên>.pages.dev,http://localhost:5173`). `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` do Supabase cung cấp sẵn. Hàm tự kiểm tra JWT + role Admin.
4. **Admin đầu tiên**: chạy `supabase/seed/create_first_admin.sql` một lần (hướng dẫn tham số ở đầu file); script từ chối nếu đã có Admin. Mật khẩu không được ghi vào bảng hay câu lệnh DDL nào, nhưng vẫn nên **đăng nhập và đổi mật khẩu tạm ngay** (app cũng bắt buộc đổi ở lần đăng nhập đầu).
5. **Dashboard → Authentication**:
   - Sign In / Providers: **tắt "Allow new users to sign up"** (không public sign-up).
   - Email provider: đặt **Minimum password length = 10** (tài khoản do Admin tạo đã được xác nhận email sẵn, không gửi thư).
   - Leaked password protection chỉ có ở gói Pro → hệ thống tự kiểm tra độ dài tối thiểu ở client (10 ký tự) và server (cài đặt trên).
6. **Run log retention** (§16): lên lịch `select public.purge_run_logs();` hằng ngày bằng pg_cron (Database → Extensions → bật `pg_cron`), xem ví dụ trong `20261026080200_rpc.sql`. Mặc định giữ 12 tháng (`app_settings.run_log_retention_months`).

## Deploy

- **Cloudflare Pages** (frontend): build command `pnpm install --frozen-lockfile && pnpm --filter @hrflow/web build`, output `apps/web/dist`, env `NODE_VERSION=22`, `PNPM_VERSION=10.28.0`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Header bảo mật (CSP…) lấy từ `apps/web/public/_headers`.
- **Keep-alive**: `.github/workflows/keep-alive.yml` ping Supabase mỗi ngày lúc 08:07 giờ VN (chỉ chạy trên `main`; GitHub tự tắt lịch nếu repo không hoạt động 60 ngày, khi đó bật lại trong tab Actions).

## Nguyên tắc bắt buộc

- Không gửi nội dung file Excel / dữ liệu nhân sự lên server, không log ra console.
- Mọi bảng Supabase bật RLS; client không dùng service role key.
- Tham số người dùng chỉ được bind dưới dạng giá trị, không nối chuỗi vào SQL/code.
- Tiền tệ và ngày công tính bằng decimal, không dùng float.
- Dữ liệu test luôn là dữ liệu giả.
- Mọi quyết định đã chốt ghi vào `docs/MEMORY.md`.

## Công nghệ

TypeScript · React 19 · Vite · Tailwind CSS v4 · Zod · big.js · SheetJS CE · ExcelJS · i18next · Supabase (supabase-js) · Vitest · Playwright · Cloudflare Pages · GitHub Actions — sắp tới: DuckDB-WASM, Pyodide, React Flow.

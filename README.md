# HR Data Flow Platform

Webapp nội bộ xử lý dữ liệu Excel **trực tiếp trên trình duyệt**. Admin cấu hình các flow xử lý (đối chiếu, gộp file, tổng hợp báo cáo…) bằng giao diện, không cần code; User chỉ cần chọn flow, upload file, chạy và tải kết quả về.

> **Dữ liệu nhân sự không rời máy người dùng.** File Excel được đọc và xử lý trong Web Worker của trình duyệt; server chỉ lưu tài khoản, cấu hình flow và log metadata.

## Trạng thái

Phase 1 (MVP) đã xong; đang ở Phase 2. Lộ trình, mốc đang mở và việc không làm: [`docs/PLAN.md`](docs/PLAN.md). Trạng thái chi tiết: [`docs/HANDOFF.md`](docs/HANDOFF.md).

| Hạng mục | Trạng thái |
|----------|-----------|
| Engine trong Web Worker: đọc Excel theo input slot, validation, DuckDB-WASM, node biến đổi (chọn cột, lọc, sắp xếp, ghép, gộp, nhóm, bỏ trùng), `code.sql`, `transform.formula` (41 hàm Excel), `control.compare`, xuất Excel nhiều sheet, xem trước | ✅ |
| Màn User: danh sách luồng xử lý, chạy (tham số → tải file và kiểm tra → chạy), kết quả | ✅ |
| Supabase: đăng nhập, đổi mật khẩu lần đầu, RLS, flow/version theo ngày hiệu lực, run log metadata | ✅ |
| Admin: tài khoản và nhóm, flow, phiên bản và hiệu lực (kèm so sánh), Flow Designer, văn bản giao diện, bảng tham chiếu (quản lý dữ liệu và phiên bản) | ✅ |
| Dùng bảng tham chiếu trong flow (node `input.refTable`) | ⏳ kế tiếp (PLAN M1) |
| Sao lưu hằng tuần có kiểm tra khôi phục (`.github/workflows/backup.yml`) | ✅ workflow; cần 2 secret (xem "Sao lưu và khôi phục") |
| Màn Lịch sử hoạt động (Logs), template Excel (`output.template`) | Chưa làm (PLAN M4, M5) |
| Python (Pyodide) | Chỉ làm khi có flow thật cần tới |

Wireframe giao diện bản đầu (chỉ tham khảo bố cục): https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (link riêng tư, cần được chia sẻ mới xem được).

## Kiến trúc tóm tắt

```
Trình duyệt ─ React SPA (UI)
             └ Web Worker: đọc .xlsx/.xls → engine (validate, DuckDB-WASM, compare…) → ghi .xlsx
                   ▲ file Excel không bao giờ upload
Supabase ──── chỉ metadata: auth, flow/version, bảng tham chiếu không chứa dữ liệu cá nhân, log
Cloudflare ── host SPA (Pages, deploy từ main)
GitHub ───── CI + Actions theo lịch: giữ Supabase không bị pause, sao lưu hằng tuần
```

Chi tiết: [`docs/spec.md`](docs/spec.md).

## Cấu trúc thư mục

```
apps/web/              React SPA + engine (src/engine: core, io, nodes)
packages/flow-schema/  Zod schema cho flow, input slot, cấu hình node (+ migrate.ts: tương thích schema)
supabase/
  migrations/          Schema, RLS, RPC (SQL thuần, áp dụng theo thứ tự tên file)
  tests/rls.sql        Kiểm thử RLS (chạy trong BEGIN … ROLLBACK, in "RLS OK")
  tests/ui_text_overrides.sql  Kiểm thử RLS bảng văn bản giao diện (in "UI TEXT OK")
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

### Đo hiệu năng trên máy thật (spec §31, AC-PF-06)

Dùng để kết luận AC-B3-24 (laptop 8 GB). Chạy trên Windows hoặc macOS có cài Google Chrome; dữ liệu giả sinh tại chỗ (thư mục temp của máy), app chạy bản build cục bộ với Supabase giả lập, không gửi gì ra ngoài.

0. Lấy mã nguồn về máy (một lần): trên GitHub mở repo → nút **Code** → **Download ZIP**, giải nén (hoặc `git clone` nếu đã có Git). "Thư mục repo" là thư mục vừa giải nén (có file `package.json`). Mở terminal trong thư mục đó: Windows bấm chuột phải vào thư mục → "Open in Terminal"; macOS: Terminal, gõ `cd ` rồi kéo thư mục vào.
1. Cài một lần: Node ≥ 22 (https://nodejs.org, bản LTS), `corepack enable` (Windows: mở terminal bằng "Run as administrator" cho riêng lệnh này; macOS có thể cần `sudo corepack enable`), rồi `pnpm install` (không cần tải trình duyệt của Playwright).
2. Đóng bớt ứng dụng nặng, cắm sạc, rồi chạy trong thư mục repo:

```bash
pnpm perf:local                                   # 100.000 dòng × 30 cột, 3 lần
pnpm perf:local -- --rows 100000,1000000          # thêm 1 triệu dòng (sinh file lần đầu mất vài phút)
```

3. Kết quả in ra từng bảng `[perf stages]` (flow lọc → ghép → tổng hợp → xuất Excel) và `[perf formula]` (công thức): thời gian trung vị (ms) của từng chặng `read` (đọc + kiểm tra file), `upload` (đẩy vào DuckDB), `sql`, `write` (ghi .xlsx) và `total`. Gửi lại nguyên các bảng này kèm cấu hình máy (CPU, RAM). AC-B3-24 đạt khi `total` của 100.000 dòng < 10 giây và 1 triệu dòng chạy xong không lỗi.

Không có Chrome mà có Edge: PowerShell `$env:PW_CHANNEL="msedge"; pnpm perf:local`, macOS `PW_CHANNEL=msedge pnpm perf:local`. Trình duyệt khác: đặt `PW_CHROMIUM_PATH` trỏ tới file chạy của Chromium.

### Biến môi trường (apps/web)

| Biến | Giá trị | Ghi chú |
|------|---------|---------|
| `VITE_SUPABASE_URL` | `https://rzakjtgvbyxqsmbpcomw.supabase.co` | Phải khớp `connect-src` trong `apps/web/public/_headers` |
| `VITE_SUPABASE_ANON_KEY` | publishable key `sb_publishable_…` | Công khai được. **Không bao giờ** dùng service role / secret key (app từ chối chạy) |
| `VITE_FLOW_SOURCE` | `local` (tùy chọn) | Chỉ khi dev: flow mẫu đóng gói sẵn, không đăng nhập. Bị bỏ qua ở bản production |

Thiếu biến khi build → app hiện màn "Ứng dụng chưa được cấu hình" (build vẫn thành công).

## Supabase (một lần khi dựng môi trường)

1. **Migrations**: chạy lần lượt `supabase/migrations/*.sql` theo thứ tự tên file (SQL editor hoặc `psql`).
2. **Kiểm thử RLS**: chạy `supabase/tests/rls.sql` (tự rollback); bằng `psql` thì dòng kết quả cuối là `RLS OK` (tương tự `versions.sql` → `VERSIONS OK`, `ui_text_overrides.sql` → `UI TEXT OK`, `ref_tables.sql` → `REF TABLES OK`, `ref_tables_qa.sql` → `REF TABLES QA OK`). Trong SQL Editor của Supabase chỉ thấy kết quả của lệnh cuối (`rollback`): đạt là "Success. No rows returned"; không đạt là lỗi có chữ `… FAIL: …`.
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
- **Sao lưu**: `.github/workflows/backup.yml`, xem mục "Sao lưu và khôi phục".
- **Keep-alive**: `.github/workflows/keep-alive.yml` ping Supabase mỗi ngày lúc 08:07 giờ VN (chỉ chạy trên `main`; GitHub tự tắt lịch nếu repo không hoạt động 60 ngày, khi đó bật lại trong tab Actions).

## Sao lưu và khôi phục

Supabase Free không có backup. `.github/workflows/backup.yml` chạy mỗi Chủ nhật 01:23 giờ VN (chạy tay: tab **Actions** → **Supabase backup** → **Run workflow**). Mỗi lần chạy:

1. Dump **dữ liệu** của schema `public` (flow, phiên bản, bảng tham chiếu, văn bản giao diện đã sửa, hồ sơ tài khoản, nhóm, log). Cấu trúc bảng không cần dump vì đã nằm trong `supabase/migrations/`.
2. **Khôi phục thử**: dựng một database tạm từ `supabase/migrations/`, nạp bản dump, so số dòng từng bảng với database thật (`scripts/backup/dump-and-verify.sh`). Lệch, hoặc database thật có bảng/cột mà migrations không có → lần chạy báo đỏ.
3. Mã hóa (GPG, AES-256) rồi lưu thành artifact trong 90 ngày. Repo đang public nên chỉ file đã mã hóa được tải lên; log chỉ in tên bảng và số dòng.

Không nằm trong bản sao lưu: tài khoản đăng nhập và mật khẩu (schema `auth`), Edge Function, cấu hình Auth. Sau sự cố phải tạo lại tài khoản (mục Supabase, bước 3–5).

**Cài một lần** — GitHub → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Giá trị |
|--------|---------|
| `SUPABASE_DB_URL` | Supabase Dashboard → nút **Connect** → mục **Session pooler** → chép chuỗi `postgresql://postgres.<mã project>:[YOUR-PASSWORD]@…pooler.supabase.com:5432/postgres`, thay `[YOUR-PASSWORD]` bằng mật khẩu database. Chưa biết mật khẩu: **Project Settings** → **Database** → **Reset database password** (app không dùng mật khẩu này nên không ảnh hưởng người dùng). Không dùng chuỗi "Direct connection" (chỉ có IPv6, máy chạy Actions không kết nối được) |
| `BACKUP_PASSPHRASE` | Một cụm mật khẩu dài tự đặt, lưu trong trình quản lý mật khẩu. Mất cụm này thì không đọc được bản sao lưu nào |

**Khôi phục** (cần `gpg` và `psql`):

```bash
# 1. Tải artifact của lần chạy gần nhất (Actions → lần chạy → Artifacts), giải nén, rồi giải mã:
gpg -d -o hrflow-data.sql hrflow-data-YYYYMMDD.sql.gpg

# 2. Database đích đã có cấu trúc (chạy supabase/migrations/*.sql theo thứ tự). Nạp dữ liệu:
psql --single-transaction -v ON_ERROR_STOP=1 \
  -c "set session_replication_role = replica" -f hrflow-data.sql "<chuỗi kết nối database đích>"
```

Bảng đích phải đang trống (migrations tự thêm vài dòng mặc định, VD `app_settings`; xem cách script làm trống bảng trước khi nạp). Các dòng gắn với tài khoản (`profiles`, `group_members`, `flow_assignments`, `run_logs`, `audit_logs`) mang id của tài khoản cũ: khi tài khoản được tạo lại với id mới thì gán lại nhóm và flow trong màn Admin. Xóa file `hrflow-data.sql` sau khi dùng.

## Nguyên tắc bắt buộc

- Không gửi nội dung file Excel / dữ liệu nhân sự lên server, không log ra console.
- Mọi bảng Supabase bật RLS; client không dùng service role key.
- Tham số người dùng chỉ được bind dưới dạng giá trị, không nối chuỗi vào SQL/code.
- Tiền tệ và ngày công tính bằng decimal, không dùng float.
- Dữ liệu test luôn là dữ liệu giả.
- Mọi quyết định đã chốt ghi vào `docs/MEMORY.md`.

## Công nghệ

TypeScript · React 19 · Vite · Tailwind CSS v4 · TanStack Router/Table/Virtual · Zod · big.js · DuckDB-WASM · Apache Arrow · SheetJS CE · ExcelJS · fflate · Comlink · React Flow · Monaco · i18next · Supabase (supabase-js) · Vitest · Playwright · Cloudflare Pages · GitHub Actions.

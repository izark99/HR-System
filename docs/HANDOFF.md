# HANDOFF — Trạng thái dự án để mở session mới

> Cập nhật: 2026-10-26. Đọc file này sau `CLAUDE.md` và `docs/MEMORY.md`.

## 1. Đã xong

| Hạng mục | Trạng thái |
|----------|-----------|
| Bước 1: engine (đọc Excel theo input slot, validation, `control.compare`, xuất Excel), DAG executor, Web Worker, 3 màn User | ✅ |
| Bước 2: Supabase (schema, RLS, RPC), đăng nhập + bắt đổi mật khẩu lần đầu, Admin Users & Groups, nhập flow JSON, run log metadata, MonthPicker/DatePicker tự làm | ✅ |
| Deploy: Cloudflare Pages deploy từ `main` → https://hr-data-flow.pages.dev | ✅ |
| Keep-alive Supabase: `.github/workflows/keep-alive.yml` (GitHub Actions, 08:07 giờ VN) | ✅ |
| Test: Vitest (~300 test), Playwright E2E (~210 test, Supabase được mock) | ✅ |

## 2. Môi trường

- **Supabase**: project `hr-data-flow`, ref `rzakjtgvbyxqsmbpcomw`, Singapore, gói Free. Đã có: 9 bảng (RLS bật), 17 hàm, Edge Function `admin-users` (v1, `verify_jwt=true`, `ALLOWED_ORIGINS` mặc định `https://hr-data-flow.pages.dev`), tài khoản `admin` (Harold đã đổi mật khẩu), flow `payroll-timesheet` v1 hiệu lực từ 2026-01-01.
- **Cloudflare Pages**: project `hr-data-flow`, production branch `main`, env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION=22`, `PNPM_VERSION=10.28.0`.
- **Nhánh**: `main` là production. Làm việc trên nhánh riêng; đưa lên `main` (fast-forward) khi lint/typecheck/test/build/e2e pass và reviewer PASS.

## 3. Lưu ý vận hành (quan trọng)

- **Kết nối Supabase (MCP)**: mọi lệnh SQL chứa `drop` hoặc `delete` làm hiện hộp xác nhận mà Harold **không thấy được** → treo 60 giây rồi hủy. Cách làm đã dùng:
  - Chạy migration bằng `execute_sql`, bỏ các lệnh `drop … if exists` khi đối tượng chưa tồn tại.
  - Phần bắt buộc chứa `drop`/`delete` (VD thân hàm có `delete`): gửi SQL để Harold dán vào SQL Editor (https://supabase.com/dashboard/project/rzakjtgvbyxqsmbpcomw/sql/new).
  - Migration đã chạy bằng `execute_sql` nên bảng `supabase_migrations` **trống**; nội dung DB khớp 3 file trong `supabase/migrations/` (trừ các lệnh drop). Migration mới: viết file mới (không sửa file cũ), áp dụng cùng cách.
- `supabase/tests/rls.sql` **chưa chạy trên DB thật** (có `delete` → vướng hộp xác nhận). Đã pass trên Postgres 16 local. Có thể nhờ Harold dán vào SQL Editor (tự rollback, cuối phải in `RLS OK`).
- Security advisor còn 2 WARN có chủ đích: `my_recent_runs` (SECURITY DEFINER, chỉ trả dữ liệu của `auth.uid()`), `purge_run_logs` (kiểm tra admin bên trong).
- Subagent có thể dừng giữa chừng khi hết hạn mức; resume bằng SendMessage, kiểm tra `git status` vì container có thể khởi động lại.

## 4. Việc còn tồn (MINOR, từ review cuối)

1. `apps/web/src/features/runner/run-store.ts` ~290: đổi kỳ khi đang chạy rồi hủy cứng → `versionCheck` có thể kẹt ở `resolving` (khóa nút Chạy đến khi đổi kỳ). Đề xuất: khi bỏ câu trả lời vì token đổi, gán `deferredAsOf = asOf` để thử lại.
2. `apps/web/src/features/admin/AdminFlowsPage.tsx` ~80: mọi migration note hiện cùng câu "csvStripped"; tách thông báo riêng cho `acceptCsvOnlyReplaced`.
3. Chunk admin được tải trước cả với User thường (router preload) — không render, không gọi API; có thể tắt preload cho route admin.

## 5. Bước tiếp theo: Bước 3 (theo MEMORY)

Phạm vi đã chốt cho bước 3:
- **Flow Designer** cho Admin: canvas kéo-thả node bằng React Flow, flow lưu JSON (DAG) — spec §8, §12, §15.2, wireframe màn 5.
- **Màn Version & hiệu lực**: Draft/Published/Retired, effective date không chồng lấn, publish, rollback = publish lại nội dung cũ, diff version — spec §14, wireframe màn 6.
- **Tự đăng xuất sau 8 giờ không thao tác** (phía trình duyệt).
- Hoãn từ bước 2: `ref_tables` / `ref_table_versions` / `templates` (spec §7.1) — cần chốt có làm trong bước 3 không.

Chưa chốt (hỏi Harold trước khi code, mỗi câu 2–3 lựa chọn A/B/C):
- Phạm vi node trong Designer cho MVP (chỉ các node đang có `input.excel`, `control.compare`, `output.excel` + nhóm transform cơ bản? có cần DuckDB-WASM/SQL/hàm Excel ngay không?).
- Draft lưu tự động hay bấm Lưu; xem trước từng node bằng file mẫu cục bộ (§13).
- Có làm bảng tham chiếu (`ref_tables`) trong bước 3 không.

Wireframe: https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (7 màn).

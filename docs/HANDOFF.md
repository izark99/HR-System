# HANDOFF — Trạng thái dự án để mở session mới

> Cập nhật: 2026-10-31. Đọc file này sau `CLAUDE.md` và `docs/MEMORY.md`.

## 1. Đã xong

| Hạng mục | Trạng thái |
|----------|-----------|
| Bước 1: engine (đọc Excel theo input slot, validation, `control.compare`, xuất Excel), DAG executor, Web Worker, 3 màn User | ✅ |
| Bước 2: Supabase (schema, RLS, RPC), đăng nhập + bắt đổi mật khẩu lần đầu, Admin Users & Groups, nhập flow JSON, run log metadata, MonthPicker/DatePicker tự làm | ✅ |
| Deploy: Cloudflare Pages deploy từ `main` → https://hr-data-flow.pages.dev | ✅ |
| Keep-alive Supabase: `.github/workflows/keep-alive.yml` (GitHub Actions, 08:07 giờ VN) | ✅ |
| Bước 3: DuckDB-WASM + 8 node transform/SQL + `output.preview`, Flow Designer (React Flow, Monaco, xem trước từng node), màn Version & hiệu lực + diff, tự đăng xuất 8 giờ, Select tự làm, engine dạng cột + đọc/ghi .xlsx theo luồng (1 triệu × 30 cột chạy được) — lên `main` 2026-10-30 (`2ffa225`) | ✅ |
| Bước 4 – R1: node `transform.formula` (41 hàm Excel → SQL DuckDB, decimal chính xác, onError theo cột, Designer Monaco + bảng hàm + Xem SQL, cảnh báo dòng lỗi trên canvas, chạy chuỗi cột dài theo nhóm bảng tạm), golden test 182 case khớp Excel thật (`fixtures/formula-golden/golden-excel.xlsx`), chống zip bomb .xlsx (2 GiB/entry, tỉ lệ 1:200 cho entry > 16 MiB, ngân sách theo file; sync dùng `fflate`, async dùng `DecompressionStream`) — lên `main` 2026-10-31 | ✅ |
| Test: Vitest (~1050 test), Playwright E2E (~325 test, Supabase được mock; test nặng opt-in `HEAVY_E2E=1`, `HRFLOW_PERF=1`) | ✅ |

## 2. Môi trường

- **Supabase**: project `hr-data-flow`, ref `rzakjtgvbyxqsmbpcomw`, Singapore, gói Free. Đã có: 9 bảng (RLS bật), các hàm của 4 migration (migration `20261027080000_designer_versions.sql` đã áp bằng `execute_sql` 2026-10-27), Edge Function `admin-users` (v1, `verify_jwt=true`, `ALLOWED_ORIGINS` mặc định `https://hr-data-flow.pages.dev`), tài khoản `admin` (Harold đã đổi mật khẩu), flow `payroll-timesheet` v1 hiệu lực từ 2026-01-01.
- **Cloudflare Pages**: project `hr-data-flow`, production branch `main`, env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION=22`, `PNPM_VERSION=10.28.0`.
- **Nhánh**: `main` là production. Làm việc trên nhánh riêng; đưa lên `main` (fast-forward) khi lint/format/typecheck/test/build/e2e pass và verifier PASS.

## 3. Lưu ý vận hành (quan trọng)

- **Kết nối Supabase (MCP)**: mọi lệnh SQL chứa `drop` hoặc `delete` làm hiện hộp xác nhận mà Harold **không thấy được** → treo 60 giây rồi hủy. Cách làm đã dùng:
  - Chạy migration bằng `execute_sql`, bỏ các lệnh `drop … if exists` khi đối tượng chưa tồn tại.
  - Phần bắt buộc chứa `drop`/`delete` (VD thân hàm có `delete`): gửi SQL để Harold dán vào SQL Editor (https://supabase.com/dashboard/project/rzakjtgvbyxqsmbpcomw/sql/new).
  - Migration đã chạy bằng `execute_sql` nên bảng `supabase_migrations` **trống**; nội dung DB khớp các file trong `supabase/migrations/` (trừ các lệnh drop). Migration mới: viết file mới (không sửa file cũ), áp dụng cùng cách.
- `supabase/tests/rls.sql` và `supabase/tests/versions.sql` **chưa chạy trên DB thật** (có `delete` → vướng hộp xác nhận). Đã pass trên Postgres 16 local. Có thể nhờ Harold dán vào SQL Editor (tự rollback, cuối phải in `RLS OK` / `VERSIONS OK`). Còn 1 WARN Auth "Leaked password protection" (chưa kiểm tra có trên gói Free không).
- Security advisor còn 2 WARN có chủ đích: `my_recent_runs` (SECURITY DEFINER, chỉ trả dữ liệu của `auth.uid()`), `purge_run_logs` (kiểm tra admin bên trong).
- **Hạn mức gói có hạn**: mỗi lúc chỉ 1 subagent (`.claude/rules/workflow.md`); subagent commit + push từng phần. Dừng giữa chừng → resume bằng SendMessage, kiểm tra `git status` (đĩa giữ được qua lần khởi động lại container).
- E2E chạy song song nhiều agent: cổng cấu hình qua `E2E_PORT` (mặc định 4173). Luôn chạy trên bản build mới (đã từng có lần build E2E lỗi âm thầm, test chạy bản cũ).
- Đội agent (chốt 2026-10-30): session chính + skill `clarify`, subagent `developer` và `verifier`.

## 4. Việc còn tồn (MINOR, chấp nhận để sau)

1. ~~Giới hạn giải nén .xlsx~~ → đã làm ở bước 4 – R1.
2. `xlsx-stream.ts` `isoToSerial`: ô `t="d"` có múi giờ (`+07:00`) hoặc phần lẻ giây đọc khác SheetJS (Excel không ghi dạng này). Test `it.fails` đang giữ chỗ.
3. Designer: nối cạnh chỉ bằng chuột (chốt 2026-10-29); cách nối bằng bàn phím chưa làm.
4. `hrflow_norm_key` khác `normalizeKeyPart` với sigma cuối Hy Lạp, ký tự NUL, chữ Unicode 16/17 mới (DuckDB 1.32 có bảng Unicode cũ hơn Node; CI chạy Node có ICU Unicode 17). Chấp nhận.
5. Hiệu năng: AC-B3-24 (100k × 30 < 10 giây) biên mỏng. 1 triệu × 30: đọc async ≈ 30–36 s, sync ≈ 42–48 s (dao động theo tải máy), upload DuckDB ≈ 19 s, SQL công thức 10 cột ≈ 28 s, ghi ≈ 60 s. AC-B4-31 mới đo trên Node, chưa đo trên Chromium.
6. File DEFLATE dựng đặc biệt (hàng chục nghìn block tí hon) đọc chậm ~100 lần/byte (cả `DecompressionStream` native cũng vậy); file ~50 MB như vậy có thể treo worker vài phút, nút Hủy vẫn dùng được. Phương án nếu cần: trần thời gian đọc mỗi file.
7. `transform.formula`: chuỗi 50 cột nối tiếp mất ≈ 3–4 s lập kế hoạch SQL (không phụ thuộc số dòng), kể cả khi xem trước; chưa có E2E cho việc ẩn cảnh báo khi sửa node phía trên (mới có unit test `preview-signature`).
8. CI GitHub (`ci.yml`) không chạy E2E; E2E phải chạy local trước khi lên `main`.

## 5. Bước tiếp theo

- **Đổi giao diện theo design language bản 2** (MEMORY 2026-10-30 13:26, 13:29; spec §25; `.claude/rules/design.md`) — vòng code riêng, ngay sau `transform.formula`.
- Sau đó: HANDOFF §4 mục #3 (nối cạnh bằng bàn phím) và #5 (tối ưu hiệu năng), rồi các mục Phase 2 trong spec §21 (`code.python`/Pyodide, template Excel, bảng tham chiếu có effective date…) — hỏi Harold thứ tự.

## 6. Token theo vòng (để so sánh hiệu quả)

| Vòng | Agent | Token (theo thông báo kết thúc, cộng dồn) |
|------|-------|------------------------------------------|
| Bước 4 – R1 + 5 vòng sửa | developer | ≈ 631k |
| Bước 4 – R1 kiểm 5 lần | verifier | ≈ 349k |

Ghi chú: vòng sửa nhiều do lỗ hổng zip bomb (size khai báo sai, fallback SheetJS, cộng dồn) và giới hạn tầng SQL; lần sau nên giao verifier fuzz sớm với phần nhạy cảm bảo mật.

Wireframe (bản 1, chỉ tham khảo bố cục): https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (7 màn).

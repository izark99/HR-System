# HANDOFF — Trạng thái dự án để mở session mới

> Cập nhật: 2026-11-04 (sau vòng nâng tooling; bộ khung UI/UX đã chốt, chờ vòng A). Đọc file này sau `CLAUDE.md` và `docs/MEMORY.md`.

## 1. Đã xong

| Hạng mục | Trạng thái |
|----------|-----------|
| Bước 1: engine (đọc Excel theo input slot, validation, `control.compare`, xuất Excel), DAG executor, Web Worker, 3 màn User | ✅ |
| Bước 2: Supabase (schema, RLS, RPC), đăng nhập + bắt đổi mật khẩu lần đầu, Admin Users & Groups, nhập flow JSON, run log metadata, MonthPicker/DatePicker tự làm | ✅ |
| Deploy: Cloudflare Pages deploy từ `main` → https://hr-data-flow.pages.dev | ✅ |
| Keep-alive Supabase: `.github/workflows/keep-alive.yml` (GitHub Actions, 08:07 giờ VN) | ✅ |
| Bước 3: DuckDB-WASM + 8 node transform/SQL + `output.preview`, Flow Designer (React Flow, Monaco, xem trước từng node), màn Version & hiệu lực + diff, tự đăng xuất 8 giờ, Select tự làm, engine dạng cột + đọc/ghi .xlsx theo luồng (1 triệu × 30 cột chạy được) — lên `main` 2026-10-30 (`2ffa225`) | ✅ |
| Bước 4 – R1: node `transform.formula` (41 hàm Excel → SQL DuckDB, decimal chính xác, onError theo cột, Designer Monaco + bảng hàm + Xem SQL, cảnh báo dòng lỗi trên canvas, chạy chuỗi cột dài theo nhóm bảng tạm), golden test 182 case khớp Excel thật (`fixtures/formula-golden/golden-excel.xlsx`), chống zip bomb .xlsx (2 GiB/entry, tỉ lệ 1:200 cho entry > 16 MiB, ngân sách theo file; sync dùng `fflate`, async dùng `DecompressionStream`) — lên `main` 2026-10-31 | ✅ |
| Giao diện bản 2 (spec §25, §28; AC-UI-01..59): token theo `docs/design-reference.md` (chỉ cấu trúc, giữ màu teal/coral/amber/blue + Be Vietnam Pro), nút 5 loại, card phẳng, thang chữ lớn (ngoại lệ 14px canvas/Monaco/bảng xem trước), màn Kết quả có tiêu đề kết luận + KPI + card tối, tiêu đề tên dài 1 dòng cắt "…", bảng Admin đủ chữ + kéo ngang + cột Thao tác biểu tượng cố định phải + menu "⋯" (APG), dialog tạo tài khoản, skeleton khi tải, thanh cuộn đồng bộ, toolbar/palette Designer gọn, `@axe-core/playwright` quét a11y, ngân sách CSS — lên `main` 2026-11-03 | ✅ |
| Test: Vitest (~1090 test), Playwright E2E (~365 test, Supabase được mock; test nặng opt-in `HEAVY_E2E=1`, `HRFLOW_PERF=1`) | ✅ |

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
3. Designer: nối cạnh chỉ bằng chuột (chốt 2026-10-29); cách nối bằng bàn phím chưa làm — xếp vào vòng B của bộ khung UI/UX (chốt 2026-11-04 15:34).
4. `hrflow_norm_key` khác `normalizeKeyPart` với sigma cuối Hy Lạp, ký tự NUL, chữ Unicode 16/17 mới (DuckDB 1.32 có bảng Unicode cũ hơn Node; CI chạy Node có ICU Unicode 17). Chấp nhận.
5. Hiệu năng: AC-B3-24 (100k × 30 < 10 giây) biên mỏng. 1 triệu × 30: đọc async ≈ 30–36 s, sync ≈ 42–48 s (dao động theo tải máy), upload DuckDB ≈ 19 s, SQL công thức 10 cột ≈ 28 s, ghi ≈ 60 s. AC-B4-31 mới đo trên Node, chưa đo trên Chromium.
6. File DEFLATE dựng đặc biệt (hàng chục nghìn block tí hon) đọc chậm ~100 lần/byte (cả `DecompressionStream` native cũng vậy); file ~50 MB như vậy có thể treo worker vài phút, nút Hủy vẫn dùng được. Phương án nếu cần: trần thời gian đọc mỗi file.
7. `transform.formula`: chuỗi 50 cột nối tiếp mất ≈ 3–4 s lập kế hoạch SQL (không phụ thuộc số dòng), kể cả khi xem trước; chưa có E2E cho việc ẩn cảnh báo khi sửa node phía trên (mới có unit test `preview-signature`).
8. CI GitHub (`ci.yml`) không chạy E2E; E2E phải chạy local trước khi lên `main`.
9. Giao diện bản 2 (MINOR): skeleton lúc chờ tải chunk route (Designer) chỉ kiểm bằng đọc code; menu "⋯" không tự đóng khi nút của nó bị cuộn khuất (vẫn nổi ở mép); bản `en` chỉ có các key mới, phần còn lại dựa vào ngôn ngữ dự phòng; ảnh chụp E2E không hiện thanh cuộn (Chromium headless ẩn).
10. Vòng nâng tooling (MINOR, verifier 2026-11-04): `check-bundle-size.mjs` chỉ cộng chunk khai báo `<link rel="modulepreload">` (hiện trùng đúng đồ thị import tĩnh của entry; nếu Vite đổi cách phát preload có thể lọt chunk). Cảnh báo direct `eval` của Rolldown trong `duckdb-browser-blocking.mjs` là có sẵn từ thư viện; CSP không có `'unsafe-eval'`, đường chạy thật không dùng tới.

## 5. Bước tiếp theo

- ~~Đổi giao diện theo design language bản 2~~ → xong 2026-11-03.
- **Vòng nâng tooling** (MEMORY 2026-11-03 09:01): xong trên nhánh `claude/exciting-clarke-3ay1w5` (2026-11-04): vite 8.3.5 + @vitejs/plugin-react 6.2.1, vitest 5 (mọi package), @playwright/test 1.64.1 (chạy trên Chromium 1243 cài sẵn qua `executablePath`), eslint 10.14, @tanstack/react-virtual 3.14.24; bỏ luật ignore plugin-react trong dependabot. lint/format/typecheck/test (1091 pass)/build (entry 163,1 KiB — số này đo thiếu, xem dòng dưới; CSS 37,4 KiB gzip)/E2E (364 pass, 5 skip) đều pass. Lên `main` 2026-11-04 (Harold duyệt bỏ qua verifier vì chỉ đổi phiên bản tooling); đã đóng PR dependabot `izark99/HR-System#9`, `#10`, `#11`, `#12`, `#13` (đã gộp).
- Vòng nâng tooling, phần bổ sung (session song song, chốt 2026-11-04 15:16; spec §30): Rolldown tách phần dùng chung ra 10 chunk tải ngay cùng entry, nên `check-bundle-size.mjs` nay cộng entry + chunk `modulepreload`: thực tế 211.105 B (206,2 KiB, giới hạn 215,2 KiB), trước nâng 212.474 B; dependabot bỏ qua `@playwright/test` (nâng tay khi Chromium môi trường đổi). Verifier kiểm vòng tooling (gói hẹp): PASS.
- **So ảnh pixel** (`toHaveScreenshot`): làm ngay sau vòng B của bộ khung UI/UX — áp `docs/patches/2026-11-04-pixel-compare.patch` (`git apply`), sinh ảnh gốc `CI=1 npx playwright test e2e/ui-v2.spec.ts e2e/ui-v2-diacritics.spec.ts --update-snapshots` (sau `pnpm --filter @hrflow/web build:e2e`), chạy 2 lần liên tiếp pass rồi commit ảnh trong `e2e/__screenshots__/`. Patch viết trên `ui-v2.spec.ts` trước vòng A/B: nếu không áp sạch thì làm lại theo nội dung patch (đồng hồ cố định `freezeClock`, thay chữ "… giây" trước khi so, trạng thái "đang chạy" không so, `maxDiffPixels: 0`).
- Sau tooling: **bộ khung UI/UX** (chốt 2026-11-04, spec §25.5 + §29, AC-UI-60..75; mẫu duyệt https://claude.ai/artifact/Cr36HRRwnWh3VHn5tJY587): vòng A (token + component), vòng B (chuyển màn Auth → User → Admin → Designer khung).
- Thứ tự đã chốt (2026-11-04 15:34, spec §21): vòng A → vòng B (gộp §4 mục #3 nối cạnh bằng bàn phím, AC-UI-76; **chốt Q27 với Harold trước khi giao vòng B**) → so ảnh pixel → §4 mục #5 tối ưu hiệu năng (vòng riêng) → Phase 2: bảng tham chiếu + `input.refTable` → `output.template` → `code.python`.

## 6. Token theo vòng (để so sánh hiệu quả)

| Vòng | Agent | Token (theo thông báo kết thúc, cộng dồn) |
|------|-------|------------------------------------------|
| Bước 4 – R1 + 5 vòng sửa | developer | ≈ 631k |
| Bước 4 – R1 kiểm 5 lần | verifier | ≈ 349k |
| Giao diện bản 2 (5 phần, dừng giữa để đổi tham chiếu thiết kế) | developer | ≈ 321k |
| Giao diện bản 2 kiểm lần 1 (full E2E, flaky, dấu tiếng Việt, AC-UI-44) | verifier | ≈ 149k |
| Giao diện bản 2 vòng sửa (AC-UI-50..56: tiêu đề 1 dòng, cột Thao tác + menu, dialog tạo tài khoản, skeleton, toolbar/palette Designer) | developer | ≈ 546k (239k + 307k) |
| Giao diện bản 2 kiểm lần 2 | verifier | ≈ 112k |
| Giao diện bản 2: Version giống Flows, sửa focus menu, bảng đủ chữ + kéo ngang, thanh cuộn | session chính (không subagent) | — |
| Nâng tooling (session song song, trùng việc với `fbc21f0`) + so ảnh pixel (hoãn, lưu patch) | session chính | — |
| Nâng tooling kiểm gói hẹp (session song song) | verifier | ≈ 75k |

Ghi chú vòng giao diện: tốn nhiều vòng do yêu cầu UI chốt dần qua ảnh chụp; lần sau với thay đổi UI nên dựng **trang mẫu tương tác (Artifact) để Harold duyệt trước khi code** (đã làm ở cuối vòng, hiệu quả). Trang ảnh duyệt: https://claude.ai/artifact/F8Zq7ULN6RSgJFfEgFcmhB; mẫu bảng: https://claude.ai/artifact/AwjFJEPc5YndnE6Z1tf56B.

Ghi chú bước 4: vòng sửa nhiều do lỗ hổng zip bomb (size khai báo sai, fallback SheetJS, cộng dồn) và giới hạn tầng SQL; lần sau nên giao verifier fuzz sớm với phần nhạy cảm bảo mật.

Wireframe (bản 1, chỉ tham khảo bố cục): https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (7 màn).

# HANDOFF — Trạng thái dự án để mở session mới

> Cập nhật: 2026-11-08 (sau vòng B của bộ khung UI/UX và các vòng sửa bố cục). Đọc file này sau `CLAUDE.md` và `docs/MEMORY.md`.

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
| Bộ khung UI/UX – vòng A (spec §29.1–29.2, AC-UI-60..69): token mới (`page-title`, `page-title-showcase`, `kpi`, `title-xs`, khoảng cách `page-x`/`page-top`/`section`/`stack`/`inline`), nút/input 44px chữ 16px; `components/layout/` (`PageShell`, `SideNavLayout`, `PageHeader`, `Section`, `Toolbar`, `StickyActionBar`), `Tabs`, `DataTable`, `FormField`, `EmptyState`, toast, `Dialog`/`ConfirmDialog` (chuyển vào `components/`), `KpiCard`/`ConclusionCard`, `Stepper`, icon gom ở `components/icons/`; luật khung trong `design-tokens.test.ts` kèm `PENDING_ROUND_B`; trang showcase chỉ trong bản build E2E (`apps/web/e2e-showcase.html`, `e2e/ui-frame*.spec.ts`) — lên `main` 2026-11-06 | ✅ |
| Bộ khung UI/UX – vòng B + 4 vòng sửa bố cục (spec §29.3, AC-UI-70..78; MEMORY 2026-11-06): mọi màn chuyển sang layout/pattern chung (User bỏ menu trái, Chạy flow có `Stepper` + `StickyActionBar`, Kết quả KPI 40px, Admin mẫu List + toast + `ConfirmDialog` chặn Esc khi busy), nối cạnh bằng bàn phím (nút "Nối tới…", Ctrl+E, đọc "Đã nối A → B"), control 44px kể cả dense, nhãn field/checkbox 1 dòng (lưới tự giảm cột, không để phần tử lẻ hàng cuối), gợi ý/giải thích sau nút (i) (`InfoTip`, 1 popover mỗi lúc), câu trạng thái hiện sẵn (`note`), mỗi chiều 1 vùng cuộn, `MiddleCut` cho tên file, lỗi cấu hình node gọi theo nhãn field, minimap ẩn khi canvas thấp, node mới đặt chỗ trống + dời khung nhìn; bộ kiểm hình học `e2e/layout-lint` (18 luật, 1280/1024/390, mọi màn + mọi loại node) — lên `main` 2026-11-08 sau khi Harold duyệt ảnh (https://claude.ai/artifact/RRMf2ZJr3qLDMhSqkZVy9k) | ✅ |
| Test: Vitest (~1170 test), Playwright E2E (~435 test, Supabase được mock; test nặng opt-in `HEAVY_E2E=1`, `HRFLOW_PERF=1`) | ✅ |

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

11. Bộ khung UI/UX vòng A (MINOR/ghi chú cho vòng B, verifier 2026-11-06): `ConfirmDialog` khi `busy` chỉ khóa nút, Esc vẫn đóng và gọi `onCancel` — vòng B chặn sự kiện `cancel` lúc busy và thêm E2E (Khóa/Retire); DatePicker qua `FormField` chưa kiểm trên DOM thật; token cũ `display-xl`/`display-lg`/`body-lg` còn (deprecated), xóa ở vòng B; `PENDING_ROUND_B` (61 vi phạm / 49 file) phải rỗng khi xong vòng B; tiêu đề màn cũ vẫn 48px tới vòng B.

12. Sau vòng B (MINOR, 2026-11-08): (a) thông báo lỗi của Input slot / Tham số (`engine.json` `slot.invalidField`, `param.invalidField`…) còn tên mục nội bộ ở `{{field}}` — cần map đường dẫn sang nhãn như `features/designer/issue-text.ts`; (b) test `infotip-qa` "pinned one and a hovered one" fail 1 lần, chạy lại 100+ lượt xanh — nếu lặp lại xem cleanup của store popover (`InfoTip.tsx`); (c) ở 1024px khi mở panel dữ liệu Designer, canvas chỉ còn ~230px; (d) bảng xem trước trong panel dữ liệu mất header dính (cuộn chung với panel); (e) ngân sách JS còn ~2,1 KiB (213,1 / 215,2) — vòng sau cần để ý; (f) hàng 3 ô của Input slot xếp 1 cột ở panel Designer (nhãn không vừa 3 cột); (g) thêm node khi khung nhìn kín: khung dời tới node mới (giữ zoom), node cũ có thể ngoài khung — dùng "Vừa khung".

## 5. Bước tiếp theo

- ~~Vòng nâng tooling~~, ~~bộ khung UI/UX vòng A, vòng B~~ → xong (lên `main` 2026-11-08).
- **Tiếp theo (theo MEMORY 2026-11-04 15:34):**
  1. **So ảnh pixel** (`toHaveScreenshot`): áp `docs/patches/2026-11-04-pixel-compare.patch` (`git apply`; patch viết trước vòng A/B nên nhiều khả năng phải áp tay theo nội dung: đồng hồ trình duyệt cố định `freezeClock`, thay chữ "… giây" trước khi so, trạng thái "đang chạy" không so, `maxDiffPixels: 0`, `snapshotPathTemplate` `e2e/__screenshots__/`), sinh ảnh gốc bằng `--update-snapshots` sau `pnpm --filter @hrflow/web build:e2e`, chạy 2 lần liên tiếp pass rồi commit ảnh. Gộp vào `e2e/ui-v2*.spec.ts` (giữ trang ảnh duyệt tay + `layout-lint`).
  2. **Tối ưu hiệu năng** (HANDOFF §4 mục #5, vòng riêng): thời gian đẩy dữ liệu vào DuckDB, AC-B3-24 (100k × 30 < 10 giây), đo AC-B4-31 trên Chromium.
  3. **Phase 2**: bảng tham chiếu có effective date + `input.refTable` → `output.template` → `code.python` (Pyodide).
- Có thể gộp mục §4.12(a) (lỗi slot/param lộ tên mục) vào vòng gần nhất có đụng Designer.

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
| Bộ khung UI/UX vòng A | developer | ≈ 239k |
| Bộ khung UI/UX vòng A kiểm (PASS, 2 MINOR session chính tự sửa) | verifier | ≈ 148k |
| Bộ khung UI/UX vòng B | developer | ≈ 478k |
| Vòng B kiểm + viết `layout-lint` (CHANGES REQUIRED) | verifier | ≈ 243k |
| Vòng sửa bố cục 1–3 (Select tràn, 44px, FieldGrid, InfoTip, cuộn lồng, nhãn 1 dòng) | developer | ≈ 790k (221k + 298k + 271k) |
| Kiểm vòng sửa (2 lần, lần cuối PASS) | verifier | ≈ 323k (162k + 161k) |

Ghi chú vòng giao diện: tốn nhiều vòng do yêu cầu UI chốt dần qua ảnh chụp; lần sau với thay đổi UI nên dựng **trang mẫu tương tác (Artifact) để Harold duyệt trước khi code** (đã làm ở cuối vòng, hiệu quả). Trang ảnh duyệt: https://claude.ai/artifact/F8Zq7ULN6RSgJFfEgFcmhB; mẫu bảng: https://claude.ai/artifact/AwjFJEPc5YndnE6Z1tf56B.

Ghi chú bước 4: vòng sửa nhiều do lỗ hổng zip bomb (size khai báo sai, fallback SheetJS, cộng dồn) và giới hạn tầng SQL; lần sau nên giao verifier fuzz sớm với phần nhạy cảm bảo mật.

Wireframe (bản 1, chỉ tham khảo bố cục): https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (7 màn).

Ghi chú vòng B: tốn nhiều vòng sửa vì lỗi bố cục chỉ lộ khi Harold xem ảnh; từ 2026-11-06 có `e2e/layout-lint` (hình học tự động) và quy tắc session chính tự soi từng ảnh trước khi gửi Harold. Hạn mức 5 giờ bị chạm 3 lần trong vòng này: subagent bị dừng thì chờ reset rồi `SendMessage` cho chính agent đó chạy tiếp (không mở agent mới).

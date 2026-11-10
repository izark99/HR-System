# HANDOFF — Trạng thái dự án để mở session mới

> Cập nhật: 2026-11-10 07:50 (sau Phase 2 bước 1 vòng 1; vòng 2 đã chốt + duyệt mẫu, chuẩn bị giao developer — xem §5). Đọc file này sau `CLAUDE.md` và `docs/MEMORY.md`.

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
| So ảnh pixel (spec §30.3, AC-TL-10..14) + lỗi Input slot/Tham số gọi theo nhãn form (AC-UI-79, §4.12a): `toHaveScreenshot` ngưỡng 0 pixel cho `ui-v2*.spec.ts`, 45 ảnh gốc (4,9 MB) ở `e2e/__screenshots__/`, đồng hồ trình duyệt cố định, "04-run / running" chỉ duyệt tay; bỏ 1 dấu sắc lệch 1 pixel vẫn bị bắt. Nhãn lỗi ở `locales/vi/engine-fields.json` (chỉ nạp trong worker, JS entry giữ 213,1 KiB) — lên `main` 2026-11-09 | ✅ |
| Tối ưu hiệu năng (spec §31, AC-PF-01..07): đẩy dữ liệu vào DuckDB bằng Arrow đúng kiểu theo row group 122.880 dòng, bỏ bảng `_raw` + CAST — 1M × 30: 13,6 → 5,0 s; 100k tổng ≈ 4 s; AC-B4-31 SQL công thức 100k/5 cột ≈ 0,75 s; đo từng chặng qua User Timing `hrflow:*` (`e2e/perf-stages.spec.ts`, `HRFLOW_PERF=1`), `pnpm perf:local` cho máy thật (README) — lên `main` 2026-11-09. AC-B3-24 trên laptop 8 GB chờ số Harold đo | ✅ |
| Thanh cuộn + khung cuộn (spec §32, AC-SB-01..09): mọi thanh cuộn (trang, vùng cuộn, Monaco) cùng kiểu 10px, luôn chừa chỗ (`scrollbar-gutter: stable`) nên đổi tab dài/ngắn không lệch ngang; từ 768px header cố định, chỉ vùng dưới cuộn (`[data-scroll-frame]`; Admin: menu trái đứng yên), dưới 768px cả trang cuộn; `layout-lint` luật 19 (thanh mặc định), 20 (không chừa chỗ); `e2e/scrollbar-shift.spec.ts` chạy Chromium bỏ cờ `--hide-scrollbars`; `shot()` tạm mở rộng vùng cuộn để chụp đủ — lên `main` 2026-11-09 sau khi Harold duyệt ảnh | ✅ |
| Tab Admin "Văn bản giao diện" (spec §33, AC-TX-01..13): Admin sửa mọi text hiện có (~1.473 key: `common`, `designer` kể cả bảng tra hàm, `engine`, `engineFields`), áp cho mọi người kể cả màn Đăng nhập; bảng `public.ui_text_overrides` (value null = mặc định, không có xóa; anon chỉ đọc `key`,`value`; chỉ admin ghi; trigger tác giả/audit) — đã áp lên Supabase thật bằng `execute_sql` 2026-11-09, `supabase/tests/ui_text_overrides.sql` chạy trên DB thật ra `UI TEXT OK` (tự rollback); override nạp lúc khởi động (chờ tối đa 1,5 s), truyền vào worker, áp cho `designer` khi nạp lười; bảng vẽ 100 dòng/lần + "Hiện thêm"; hover hàm công thức escape Markdown — lên `main` 2026-11-09 | ✅ |
| Phase 2 bước 1 vòng 1 — Bảng tham chiếu (spec §34, AC-RT-01..06, 09 phần bảng, 11..14): `ref_tables` + `ref_table_versions` (JSON rows ≤ 50.000 dòng / 5 MiB, draft → published → retired, hủy draft = `discarded`, không chồng hiệu lực, published bất biến, rollback chiếu lên cột hiện tại), RPC `security invoker`, chỉ Admin (User đọc ở vòng 2); màn Admin danh sách / cột (cảnh báo dữ liệu cá nhân + audit) / phiên bản (Publish, Retire, Hủy, so sánh theo khóa) / lưới sửa (hoàn tác, dán nhiều ô, lô 100 dòng, lỗi tại ô) / Import Excel trong worker — migration `20261109150000_ref_tables.sql` áp lên Supabase thật bằng `execute_sql` 2026-11-10 (bài test rollback trên DB thật OK) — lên `main` 2026-11-10 | ✅ |
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
5. Hiệu năng (cập nhật 2026-11-09 sau §31: upload DuckDB 1M ≈ 5 s, 100k tổng ≈ 4 s trên Chromium container; chặng lớn nhất còn lại là đọc .xlsx ≈ 40 s/1M ≈ 85% tổng, chưa tối ưu — Harold quyết). Số cũ: AC-B3-24 (100k × 30 < 10 giây) biên mỏng. 1 triệu × 30: đọc async ≈ 30–36 s, sync ≈ 42–48 s (dao động theo tải máy), upload DuckDB ≈ 19 s, SQL công thức 10 cột ≈ 28 s, ghi ≈ 60 s. AC-B4-31 mới đo trên Node, chưa đo trên Chromium.
6. File DEFLATE dựng đặc biệt (hàng chục nghìn block tí hon) đọc chậm ~100 lần/byte (cả `DecompressionStream` native cũng vậy); file ~50 MB như vậy có thể treo worker vài phút, nút Hủy vẫn dùng được. Phương án nếu cần: trần thời gian đọc mỗi file.
7. `transform.formula`: chuỗi 50 cột nối tiếp mất ≈ 3–4 s lập kế hoạch SQL (không phụ thuộc số dòng), kể cả khi xem trước; chưa có E2E cho việc ẩn cảnh báo khi sửa node phía trên (mới có unit test `preview-signature`).
8. CI GitHub (`ci.yml`) không chạy E2E; E2E phải chạy local trước khi lên `main`.
9. Giao diện bản 2 (MINOR): skeleton lúc chờ tải chunk route (Designer) chỉ kiểm bằng đọc code; menu "⋯" không tự đóng khi nút của nó bị cuộn khuất (vẫn nổi ở mép); bản `en` chỉ có các key mới, phần còn lại dựa vào ngôn ngữ dự phòng; ảnh chụp E2E không hiện thanh cuộn (Chromium headless ẩn).
10. Vòng nâng tooling (MINOR, verifier 2026-11-04): `check-bundle-size.mjs` chỉ cộng chunk khai báo `<link rel="modulepreload">` (hiện trùng đúng đồ thị import tĩnh của entry; nếu Vite đổi cách phát preload có thể lọt chunk). Cảnh báo direct `eval` của Rolldown trong `duckdb-browser-blocking.mjs` là có sẵn từ thư viện; CSP không có `'unsafe-eval'`, đường chạy thật không dùng tới.

11. Bộ khung UI/UX vòng A (MINOR/ghi chú cho vòng B, verifier 2026-11-06): `ConfirmDialog` khi `busy` chỉ khóa nút, Esc vẫn đóng và gọi `onCancel` — vòng B chặn sự kiện `cancel` lúc busy và thêm E2E (Khóa/Retire); DatePicker qua `FormField` chưa kiểm trên DOM thật; token cũ `display-xl`/`display-lg`/`body-lg` còn (deprecated), xóa ở vòng B; `PENDING_ROUND_B` (61 vi phạm / 49 file) phải rỗng khi xong vòng B; tiêu đề màn cũ vẫn 48px tới vòng B.

12. Sau vòng B (MINOR, 2026-11-08): (a) ~~lỗi Input slot / Tham số lộ tên mục nội bộ~~ → đã sửa 2026-11-09 (AC-UI-79); (b) test `infotip-qa` "pinned one and a hovered one" fail 1 lần, chạy lại 100+ lượt xanh — nếu lặp lại xem cleanup của store popover (`InfoTip.tsx`); (c) ở 1024px khi mở panel dữ liệu Designer, canvas chỉ còn ~230px; (d) bảng xem trước trong panel dữ liệu mất header dính (cuộn chung với panel); (e) ngân sách JS còn ~2,1 KiB (213,1 / 215,2) — vòng sau cần để ý; (f) hàng 3 ô của Input slot xếp 1 cột ở panel Designer (nhãn không vừa 3 cột); (g) thêm node khi khung nhìn kín: khung dời tới node mới (giữ zoom), node cũ có thể ngoài khung — dùng "Vừa khung".

13. Vòng so ảnh pixel (MINOR, verifier 2026-11-09): (a) không được nới `maxDiffPixels` (bỏ dấu sắc chỉ lệch 1 pixel; `threshold` màu để mặc định 0,2); (b) chưa có `locales/en/engine-fields.json` — khi thêm tiếng Anh phải thêm, nếu không nhãn tiếng Việt chen vào câu tiếng Anh; (c) key `auth.tagline` không dùng ở đâu; (d) kiểm tra trước Publish ở màn Version chỉ được unit test phủ (dùng chung `checkDesign`), chưa có E2E riêng cho nhãn; (e) đổi giao diện hoặc đổi Chromium → chạy `CI=1 npx playwright test e2e/ui-v2 --update-snapshots` sau `build:e2e`, soi diff ảnh, commit ảnh cùng commit đổi UI.

14. Vòng hiệu năng (MINOR, verifier 2026-11-09): (a) SQL công thức chậm hơn thật ≈ 5–8% (+40–60 ms ở 100k; bố cục row group mới), vẫn xa mục tiêu 2 s, tổng lần chạy nhanh hơn; (b) entry User Timing `hrflow:read` trong worker tăng 1 mỗi lần chọn file, không bị xóa ngoài E2E (rất nhỏ, không chứa dữ liệu); (c) `pnpm perf:local -- --no-build` chỉ dùng được với bản `build:e2e`; (d) thứ tự cột khi upload đã có kiểm tra chặn (`scope.ts`), lỗi nếu lệch.

15. Thanh cuộn + khung cuộn (MINOR, verifier 2026-11-09): (a) màn Chạy flow: `PageShell className="pb-0"` thua `pb-12` (cùng `cx`, thứ tự CSS Tailwind) nên dưới thanh nút dính đáy còn dải 48px khi cuộn tới cuối — có từ trước vòng này; sửa thì ảnh gốc màn Chạy flow đổi; (b) chỉ kiểm Chromium (Firefox chỉ đổi được bề dày + màu thanh cuộn); (c) lúc đang tải chunk Admin (skeleton) chưa có vùng cuộn nên `html` chừa 10px thoáng qua; (d) `main#main` có tabIndex -1 ngoài Designer (click vùng trống focus `main`); Designer không có, `onCanvas()` coi `main` như body.

16. Tab "Văn bản giao diện" (MINOR, 2026-11-09): (a) **ngân sách JS tải ban đầu còn ~675 B** (214,6 / 215,2 KiB; i18next bị Rolldown tách thành chunk preload riêng) — vòng sau thêm code vào entry gần như chắc vượt: phải cắt chỗ khác hoặc Harold quyết nâng ngân sách; (b) `authenticated` đọc được `updated_by` (uuid) của dòng đã sửa — Harold chấp nhận (MEMORY 13:06); (c) worker chỉ nhận chữ mới ở lần gọi kế tiếp; (d) ảnh so pixel `10-versions--row-menu-open` lệch 37 pixel 1 lần trong full E2E (chạy lại pass) — nếu lặp lại xem vị trí menu "⋯" lúc đo; (e) Supabase cấp mọi quyền bảng mới cho `anon`/`authenticated` mặc định: migration mới phải `revoke all … from public, anon, authenticated` trước khi `grant` (stub local không có quyền mặc định này nên test local không bắt được).

17. Bảng tham chiếu vòng 1 (MINOR, 2026-11-10): (a) **ngân sách JS còn ~0,5 KiB** (214,7/215,2); (b) lưu 5 MB qua PostgREST chưa đo trên Supabase thật (giới hạn request của gateway); (c) DB so khóa bằng `btrim`, không chuẩn hóa NFC (client chặt hơn); (d) đổi kiểu cột khi đã có bản published: dữ liệu cũ giữ kiểu cũ — vòng 2 (engine) phải xử lý giá trị không khớp kiểu; (e) `supabase/tests/ref_tables*.sql` mới chạy trên Postgres local; trên DB thật chạy bài test rút gọn (rollback).

## 5. Bước tiếp theo

> Trạng thái lúc 2026-11-10 07:50: `main` = `716ec58` + commit docs trên nhánh `claude/hopeful-wright-a2fhd1` (MEMORY/spec vòng 2). Không có việc dở chưa commit.

- **Đang làm: Phase 2 bước 1 – vòng 2 (bảng tham chiếu)**. Phạm vi: spec §34 AC-RT-07 (node `input.refTable`, Designer: palette Đầu vào, form chọn bảng, ghi rõ version dùng xem trước), AC-RT-08 (chọn version theo as-of khi chạy, lỗi thiếu version, run log `ref_versions`, Designer xem trước theo tham số mẫu), AC-RT-09 phần còn lại (`flow_versions.ref_tables` do trigger tính từ `definition` lúc Publish; User chỉ SELECT version published của bảng nằm trong flow được gán; migration mới, không từ khóa drop/delete, `revoke all` trước `grant`), AC-RT-10 (tham số `fromRefTable`), AC-RT-15 (kiểm thiếu version ngay khi chọn kỳ, tự chuyển kiểu ô / chặn chạy, dữ liệu chỉ trong RAM, hộp "Xem bảng" chỉ đọc), AC-RT-02 phần kiểm thiết kế (flow dùng cột không còn → lỗi). MEMORY 2026-11-09 14:28/14:37, 2026-11-10 07:47 và dòng duyệt mẫu 2026-11-10 07:50.
  - Mẫu đã duyệt: Designer (màn 5) https://claude.ai/artifact/92KZJ49WJTdFoxWMo26kar — HTML `/tmp/claude-0/-home-user-HR-System/8e399ec8-d20c-5aa2-bcb6-380f9e44567a/scratchpad/bang-tham-chieu.html`; màn Chạy flow https://claude.ai/artifact/WB8Ndbb5CXYgsr2muW5pET — HTML `…/scratchpad/xem-bang-tham-chieu.html` (scratchpad có thể mất khi đổi container; khi đó đọc lại bằng Artifact read).
  - Quy trình: developer (gói bối cảnh như trên) → session chính soi ảnh → verifier → áp migration lên Supabase thật bằng `execute_sql` + bài test rollback trên DB thật → full E2E → gửi Harold ảnh → lên `main`.
  - Rủi ro: ngân sách JS còn ~0,5 KiB (code mới phải ở chunk lười: màn Chạy flow, Designer, worker); run log thêm `ref_versions` (không dữ liệu); RLS User đọc theo flow được gán.
- Sau vòng 2: Phase 2 bước 2 `output.template` → bước 3 `code.python` (Pyodide); vòng nâng thư viện gom 6 PR dependabot (MEMORY 07:47).
- Chờ Harold: chạy `pnpm perf:local` trên laptop (AC-B3-24); quyết xóa 4 nhánh `claude/*` cũ đã nằm trong `main` (beautiful-babbage, wizardly-knuth, exciting-clarke, eager-albattani).

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
| So ảnh pixel + §4.12a | session chính (không subagent code) | — |
| So ảnh pixel + §4.12a kiểm (PASS, 2 MINOR) | verifier | ≈ 93k |
| Tối ưu hiệu năng (upload DuckDB) | developer | ≈ 191k |
| Tối ưu hiệu năng kiểm (PASS, 3 MINOR — session chính sửa 2) | verifier | ≈ 99k |
| Thanh cuộn (§32 phần 1) | session chính | — |
| Khung cuộn (header cố định) | developer | ≈ 155k |
| Thanh cuộn + khung cuộn kiểm (1 MAJOR Designer dán node — session chính sửa) | verifier | ≈ 114k |
| Tab "Văn bản giao diện" (dừng 1 lần vì hạn mức 5 giờ, resume) | developer | ≈ 324k |
| Tab "Văn bản giao diện" kiểm (PASS, 1 MAJOR hiệu năng + 2 MINOR — session chính sửa) | verifier | ≈ 128k |
| Bảng tham chiếu vòng 1 + lượt sửa (dừng 1 lần vì hạn mức) | developer | ≈ 1,09M (527k + 561k) |
| Bảng tham chiếu vòng 1 kiểm (PASS, 1 MAJOR + 4 MINOR) | verifier | ≈ 203k |

Ghi chú vòng giao diện: tốn nhiều vòng do yêu cầu UI chốt dần qua ảnh chụp; lần sau với thay đổi UI nên dựng **trang mẫu tương tác (Artifact) để Harold duyệt trước khi code** (đã làm ở cuối vòng, hiệu quả). Trang ảnh duyệt: https://claude.ai/artifact/F8Zq7ULN6RSgJFfEgFcmhB; mẫu bảng: https://claude.ai/artifact/AwjFJEPc5YndnE6Z1tf56B.

Ghi chú bước 4: vòng sửa nhiều do lỗ hổng zip bomb (size khai báo sai, fallback SheetJS, cộng dồn) và giới hạn tầng SQL; lần sau nên giao verifier fuzz sớm với phần nhạy cảm bảo mật.

Wireframe (bản 1, chỉ tham khảo bố cục): https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (7 màn).

Ghi chú vòng B: tốn nhiều vòng sửa vì lỗi bố cục chỉ lộ khi Harold xem ảnh; từ 2026-11-06 có `e2e/layout-lint` (hình học tự động) và quy tắc session chính tự soi từng ảnh trước khi gửi Harold. Hạn mức 5 giờ bị chạm 3 lần trong vòng này: subagent bị dừng thì chờ reset rồi `SendMessage` cho chính agent đó chạy tiếp (không mở agent mới).

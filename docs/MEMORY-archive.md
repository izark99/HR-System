# MEMORY — Lưu trữ quyết định đã bị thay

> Các quyết định từng chốt nhưng đã được thay bằng quyết định mới hơn trong `docs/MEMORY.md` (chuyển sang đây từ 2026-11-12 21:14).
> File này **không** được nạp tự động vào session; chỉ mở khi cần tra lịch sử. Không dùng nội dung ở đây làm căn cứ: quyết định đang hiệu lực nằm ở `docs/MEMORY.md`.
> Giữ nguyên chữ gốc, mỗi dòng kèm `→ thay bởi YYYY-MM-DD HH:MM`; dòng mới nhất đặt ở đầu từng nhóm; không xóa.

## Phạm vi & sản phẩm

~~2026-11-09 09:06 - Tab Admin "Văn bản giao diện" (menu trái): Admin sửa text tiếng Việt của mọi màn User + Admin và thông báo kiểm tra file / lỗi chạy mà User thấy (engine; text đã sửa được truyền vào worker); không gồm Designer và bảng tra hàm công thức. Áp dụng chung cho mọi người dùng, kể cả màn Đăng nhập (bảng text đã sửa đọc được không cần đăng nhập vì chỉ chứa chữ giao diện, không dữ liệu cá nhân; chỉ Admin ghi). Chỉ chữ thuần (không HTML/link); chặn lưu khi thiếu/thừa biến `{{…}}`; độ dài ≤ 2 lần bản gốc (tối thiểu 40 ký tự); "Khôi phục mặc định" từng dòng và tất cả; lưu người sửa + thời điểm sửa gần nhất, không lịch sử phiên bản.~~ → thay bởi 2026-11-09 09:14

~~2026-11-04 15:34 - Thứ tự Phase 2: (1) bảng tham chiếu có effective date (`ref_tables`, `ref_table_versions`) + node `input.refTable`; (2) `output.template` (template Excel); (3) `code.python` (Pyodide). Các node Phase 2 khác chưa xếp thứ tự.~~ → thay bởi 2026-11-12 21:14

~~2026-10-30 17:32 - Vòng code đầu của bước 4 gộp thêm HANDOFF §4 mục #1 (giới hạn giải nén .xlsx: 2 GiB/entry; tỉ lệ nén ≤ 1:200 chỉ áp cho entry giải nén > 16 MiB, kèm giới hạn chống cộng dồn nhiều entry nhỏ; vượt → báo "file quá lớn"); mục #2, #4 giữ nguyên (chấp nhận); mục #3 (nối cạnh bằng bàn phím) và #5 (tối ưu hiệu năng, gồm thời gian đẩy dữ liệu vào DuckDB) làm vòng riêng sau `transform.formula`.~~ → thay bởi 2026-11-04 15:34

~~2026-10-30 13:18 - Vòng code đầu của bước 4 gộp thêm HANDOFF §4 mục #1 (giới hạn giải nén .xlsx: ~1 GB/entry, tỉ lệ nén ≤ 1:200, vượt → báo "file quá lớn"); mục #2, #4 giữ nguyên (chấp nhận); mục #3 (nối cạnh bằng bàn phím) và #5 (tối ưu hiệu năng) làm vòng riêng sau `transform.formula`.~~ → thay bởi 2026-10-30 17:32

~~2026-10-26 22:52 - Bước 3 gồm: Flow Designer (React Flow) với node `input.excel`, `control.compare`, `output.excel` + DuckDB-WASM và nhóm transform cơ bản `transform.select`, `transform.filter`, `transform.sort`, `transform.join`, `transform.union`, `transform.groupBy`, `transform.dedupe`, `code.sql`; màn Version & hiệu lực (kèm diff); tự đăng xuất sau 8 giờ. `transform.formula` (hàm Excel → SQL) chưa nằm trong bước 3.~~ → thay bởi 2026-10-27 07:31

## Hạ tầng

~~2026-10-26 22:52 - DuckDB-WASM tự host trên Cloudflare Pages: lúc build tách file `.wasm` (~34 MB, vượt giới hạn 25 MiB/file) thành các phần < 25 MiB; worker tải, kiểm tra checksum, ghép lại rồi khởi tạo; cache bằng Cache Storage. Không thêm domain ngoài, CSP giữ nguyên.~~ → thay bởi 2026-10-27 07:31

~~2026-10-26 08:20 - Dùng Cloudflare Cron Worker ping Supabase hằng ngày để tránh project bị pause sau 7 ngày.~~ → thay bởi 2026-10-26 20:27

## Xác thực & phân quyền

~~2026-10-27 08:49 - Tự đăng xuất (hết 8 giờ) dùng đăng xuất toàn cục: thu hồi refresh token trên server, các phiên khác của cùng tài khoản cũng bị đăng xuất; mất mạng thì vẫn đăng xuất cục bộ.~~ → thay bởi 2026-10-27 12:30

## Flow & xử lý

~~2026-11-06 08:24 - Designer: nối cạnh bằng bàn phím (vòng B của bộ khung UI/UX): chọn node → nút "Nối tới…" trên thanh công cụ (kèm phím tắt) mở danh sách cổng đích có tìm kiếm (Select tự làm), Enter để nối; thông báo cho trình đọc màn hình "Đã nối A → B"; nối bằng chuột giữ nguyên.~~ → thay bởi 2026-11-06 12:32

~~2026-11-04 15:34 - Designer: nối cạnh bằng bàn phím làm trong vòng B của bộ khung UI/UX (cách thao tác cụ thể chốt trước khi giao vòng B, spec Q27); bước 3 chỉ nối bằng chuột.~~ → thay bởi 2026-11-06 08:24

~~2026-10-30 13:18 - `transform.formula` bản đầu hỗ trợ 37 hàm: IF, IFS, AND, OR, NOT, SWITCH, IFERROR, ISBLANK, ISNUMBER; ROUND, ROUNDUP, ROUNDDOWN, INT, ABS, MIN, MAX, MOD, SUM; LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, PROPER, CONCAT, TEXTJOIN, SUBSTITUTE, FIND, SEARCH, VALUE; DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, DATEDIF, WEEKDAY; PARAM.~~ → thay bởi 2026-10-30 17:24

~~2026-10-29 21:18 - Designer: nối cạnh chỉ bằng chuột ở bước 3 (React Flow không hỗ trợ bàn phím); cách nối bằng bàn phím làm ở R4 nếu còn hạn mức.~~ → thay bởi 2026-11-04 15:34

## Kỹ thuật & tổ chức

~~2026-11-12 21:14 - Harold duyệt `docs/PLAN.md` (lộ trình M0 → M5) và cho đưa lên `main`.~~ → thay bởi 2026-11-13 12:55

~~2026-11-12 21:09 - Harold giao session chính vai trò project owner: lộ trình, mốc và nguyên tắc điều hành ghi ở `docs/PLAN.md` (đọc sau MEMORY, trước HANDOFF); bài học đã gặp ghi ở `.claude/rules/pitfalls.md` (luôn nạp). Mục nào của PLAN đổi một quyết định đã chốt (đánh dấu D-n) chỉ có hiệu lực sau khi Harold chốt và được ghi vào file này.~~ → thay bởi 2026-11-13 12:55

~~2026-11-06 14:48 - Thanh cuộn của panel giữ như cũ (chỉ hiện khi cần, không chừa chỗ sẵn). Lỗi ở tab Input slot là 2 thanh cuộn lồng nhau (khung ngoài cuộn thêm vì nội dung panel vượt chiều cao khung): sửa tận gốc để mỗi vùng chỉ có 1 thanh cuộn theo mỗi chiều; `layout-lint` chặn vùng cuộn lồng nhau cùng chiều.~~ → thay bởi 2026-11-09 09:06

~~2026-11-06 14:45 - Mọi vùng cuộn trong app luôn chừa chỗ thanh cuộn (`scrollbar-gutter: stable`) để đổi tab/nội dung dài ngắn không làm lệch bố cục.~~ → thay bởi 2026-11-06 14:48

~~2026-11-04 15:16 - Ngân sách bundle: JS tải ban đầu (gzip) = entry chunk + các chunk tải ngay cùng entry (`<link rel="modulepreload">`, vì Vite 8/Rolldown tách phần dùng chung ra khỏi entry) không tăng quá 10% so với cuối bước 2 (commit `d079f6b`, baseline giữ nguyên); build tự kiểm tra và báo lỗi khi vượt.~~ → thay bởi 2026-11-12 21:14

~~2026-11-04 13:39 - So ảnh pixel (`toHaveScreenshot`) cho toàn bộ các trạng thái của `e2e/ui-v2.spec.ts`, làm ngay sau vòng nâng tooling: ảnh gốc sinh trên Chromium cài sẵn và commit vào repo; đổi giao diện hoặc đổi Chromium thì cập nhật ảnh gốc trong cùng commit. Vẫn giữ trang ảnh duyệt tay và kiểm giá trị CSS.~~ → thay bởi 2026-11-04 15:16

~~2026-11-04 13:39 - Dependabot: merge bản vá/bản nhỏ khi CI xanh. Vòng nâng tooling nâng trực tiếp trên nhánh làm việc (mỗi gói 1 commit; PR dependabot tự đóng khi `main` có bản mới): vite 8 cùng @vitejs/plugin-react 6 (bỏ luật ignore), vitest 5. `@playwright/test` giữ 1.63.0 vì 1.64 cần Chromium 156 (rev 1248) còn môi trường cài sẵn Chromium 153 (rev 1243); dependabot bỏ qua `@playwright/test` cho tới khi Chromium của môi trường được nâng; đóng PR #9. Bỏ qua major của `@types/node` (runtime Node 22) và `apache-arrow` (theo DuckDB-WASM).~~ → thay bởi 2026-11-04 15:16

~~2026-11-03 16:22 - Duyệt mẫu bảng Admin (https://claude.ai/artifact/AwjFJEPc5YndnE6Z1tf56B): dòng cao 56px; biểu tượng bút chì = Sửa / Mở Designer, con mắt = Xem trong Designer, chồng lớp = Mở trang phiên bản; cột Phiên bản ở màn Flows hiện 2 phiên bản mới nhất kèm ngày "từ dd/MM/yyyy" ngay trong ô (+N cho phần còn lại). Thanh cuộn của mọi vùng cuộn trong app đồng bộ: mảnh 10px, rãnh `#F1F5F9`, tay kéo bo tròn `#475569`, hover `#1F2A44`.~~ → thay bởi 2026-11-04 14:12

~~2026-11-03 15:18 - Bảng Admin (Users, Nhóm, Flows, Version): mọi dòng cùng chiều cao; mỗi ô 1 dòng, chữ dài cắt "…" và hiện đủ khi rê chuột/focus; nhiều chip trong 1 ô nằm cùng 1 hàng; bảng vừa chiều ngang card ở 1280px (cột Thao tác không che cột khác), cột Thao tác có vạch ngăn bên trái như bảng Flows.~~ → thay bởi 2026-11-03 16:06

~~2026-11-03 14:53 - Màn Admin (Users & Groups, Nhóm, Flows, Version): chip trạng thái, menu trái ("Sắp có"), nhãn nút không xuống dòng vỡ bố cục. Cột Thao tác dùng chung cho mọi bảng Admin: 1 nút chữ (`button-text` của `docs/design-reference.md`: không viền, 14,4px/700, hover nền `#F1F5F9`, vùng bấm cao 36px) cho thao tác hay dùng + nút chữ "Thao tác khác ▾" mở menu (bàn phím theo APG menu button) chứa phần còn lại; thao tác nguy hiểm (Khóa, Retire, Hủy draft…) ở cuối menu, chữ coral, giữ hộp xác nhận. Nút hiện sẵn: Users "Sửa"; Nhóm "Sửa"; Flows "Mở trang phiên bản"; Version draft "Mở Designer" (Publish là mục đầu của menu, giống kiểu bảng Flows: chỉ nút chữ, không có nút teal trong bảng); Version published/retired "Xem trong Designer".~~ → thay bởi 2026-11-03 15:32

~~2026-11-03 13:24 - Màn Admin (Users & Groups, Nhóm, Flows, Version): chip trạng thái, menu trái ("Sắp có"), nhãn nút không xuống dòng vỡ bố cục. Cột Thao tác dùng chung cho mọi bảng Admin: 1 nút chữ (`button-text` của `docs/design-reference.md`: không viền, 14,4px/700, hover nền `#F1F5F9`, vùng bấm cao 36px) cho thao tác hay dùng + nút chữ "Thao tác khác ▾" mở menu (bàn phím theo APG menu button) chứa phần còn lại; thao tác nguy hiểm (Khóa, Retire, Hủy draft…) ở cuối menu, chữ coral, giữ hộp xác nhận. Nút hiện sẵn: Users "Sửa"; Nhóm "Sửa"; Flows "Mở trang phiên bản"; Version draft "Mở Designer" + "Publish" (nút chính teal cỡ nhỏ); Version published/retired "Xem trong Designer".~~ → thay bởi 2026-11-03 14:53

~~2026-11-03 10:51 - Màn Admin (Users & Groups, Nhóm, Flows, Version): chip trạng thái, menu trái ("Sắp có"), nhãn nút không xuống dòng vỡ bố cục. Cột Thao tác dùng chung cho mọi bảng Admin: 1 nút nhỏ viền 36px cho thao tác hay dùng + nút "Thao tác khác ▾" mở menu (bàn phím theo APG menu button) chứa phần còn lại; thao tác nguy hiểm (Khóa, Retire, Hủy draft…) ở cuối menu, chữ coral, giữ hộp xác nhận. Nút hiện sẵn: Users "Sửa"; Nhóm "Sửa"; Flows "Mở trang phiên bản"; Version draft "Mở Designer" + "Publish" (nút chính); Version published/retired "Xem trong Designer".~~ → thay bởi 2026-11-03 13:24

~~2026-11-03 10:49 - Tiêu đề trang giữ cao dòng bằng cỡ chữ (48/48, mobile 32/32); tiêu đề chứa tên do người dùng đặt (tên flow, tên version…) giới hạn 1 dòng, cắt bằng "…", hiện đủ tên khi rê chuột/focus (tránh dấu tiếng Việt chồng dòng).~~ → thay bởi 2026-11-04 14:12

~~2026-11-03 10:49 - Màn Admin (Users & Groups, Version…): chữ trong chip trạng thái, menu trái ("Sắp có"), nhãn nút không bị xuống dòng vỡ bố cục; cột Thao tác dùng chung một kiểu cho mọi bảng Admin (kiểu cụ thể: câu hỏi mở Q25 trong spec).~~ → thay bởi 2026-11-03 10:51

~~2026-11-03 10:13 - UI/UX đồng nhất theo design language "bright executive" bản 2 (phong cách phẳng), cấu trúc lấy đúng số của `docs/design-reference.md`: giữ nguyên bộ màu (nền #F7FAF9, card trắng; teal = tốt/chính, coral = rủi ro/lỗi, amber = cảnh báo, blue = thông tin) và font Be Vietnam Pro; tiêu đề lớn (`display-xl` 56/56, `display-lg` 48/48) weight 500, `title-md` 24px/600, `title-sm` 20px/700, eyebrow 14px/500 giãn chữ 1px không nền, nút 18px/600 lh 27px, nút nhỏ 14,4px/700; card bo 12px, viền 1px #E2E8F0, không shadow (popover/modal/toast giữ shadow nhẹ); input bo 6px; nút 3 cấp bo 12px cao 48px (chính teal #0F766E, tối #1F2A44, outline viền #1F2A44); menu trái mục đang chọn có vạch màu bên trái; body 16px; trang đăng nhập nền phẳng + card có viền. Font tự host thêm lại weight 500, vẫn bỏ 800; ngân sách CSS gzip +10% giữ nguyên. Chi tiết token ở docs/spec.md §25.~~ → thay bởi 2026-11-04 14:12

~~2026-11-03 10:06 - Design language tham chiếu là file `docs/design-reference.md` (Harold gửi): chỉ lấy phần cấu trúc (bo góc, nút, thang chữ, eyebrow, khoảng cách); giữ bộ màu teal/coral/amber/blue và font Be Vietnam Pro theo §25; chữ thường (body) giữ 16px (file dùng 18px).~~ → thay bởi 2026-11-04 14:12

~~2026-11-03 09:07 - Bỏ font weight 800 (và 500 nếu không còn dùng); script ngân sách bundle thêm kiểm CSS gzip không tăng quá 10% so với `main` trước vòng giao diện.~~ → thay bởi 2026-11-03 10:13

~~2026-11-03 09:01 - Dependabot: merge bản vá/bản nhỏ khi CI xanh; bản major của tooling (vite 8 cùng @vitejs/plugin-react 6, vitest 5, @playwright/test mới — cần khớp Chromium cài sẵn) gom vào một vòng "nâng tooling" riêng ngay sau vòng đổi giao diện, chạy đủ E2E; các PR #9, #11, #13 để mở tới lúc đó. Bỏ qua major của `@types/node` (runtime Node 22) và `apache-arrow` (theo DuckDB-WASM).~~ → thay bởi 2026-11-04 13:39

~~2026-10-30 22:59 - Giải nén entry .xlsx (đường đồng bộ và bất đồng bộ có giới hạn) dùng thư viện `fflate` (MIT, giải nén theo luồng, dừng sớm được), không dùng bộ giải mã DEFLATE tự viết.~~ → thay bởi 2026-10-30 23:29

~~2026-10-30 13:26 - UI/UX đồng nhất theo design language "bright executive" bản 2 (phong cách phẳng): giữ nguyên bộ màu (nền #F7FAF9, card trắng; teal = tốt/chính, coral = rủi ro/lỗi, amber = cảnh báo, blue = thông tin) và font Be Vietnam Pro (tiêu đề weight 600); card bo 12px, viền 1px #E2E8F0, không shadow (popover/modal/toast giữ shadow nhẹ); input bo 6px; nút 3 cấp bo 12px cao 48px (chính teal #0F766E, tối #1F2A44, outline viền #1F2A44); eyebrow chữ in hoa giãn chữ, không nền; menu trái mục đang chọn có vạch màu bên trái; thang chữ lớn (body 16–18px, tiêu đề trang 48px); trang đăng nhập nền phẳng + card có viền. Chi tiết token ở docs/spec.md §25.~~ → thay bởi 2026-11-03 10:13

~~2026-10-29 21:18 - Tester và reviewer chạy nối tiếp nhau (không song song) để tiết kiệm hạn mức; ghi trong `.claude/rules/workflow.md`.~~ → thay bởi 2026-10-30 12:51

~~2026-10-27 07:36 - Ngân sách bundle: entry chunk (gzip) không tăng quá 10% so với cuối bước 2 (commit `d079f6b`); build tự kiểm tra và báo lỗi khi vượt.~~ → thay bởi 2026-11-04 15:16

~~2026-10-26 09:24 - UI/UX đồng nhất theo design language "bright executive": font Be Vietnam Pro, nền sáng #F7FAF9, card trắng bo 20px + shadow nhẹ, eyebrow pill trên tiêu đề, màu theo ý nghĩa (teal = tốt/chính, coral = rủi ro/lỗi, amber = cảnh báo, blue = thông tin). Chi tiết token ở docs/spec.md §25.~~ → thay bởi 2026-10-30 13:26

~~2026-10-26 08:20 - Team agent gồm: requirements-analyst (viết yêu cầu), developer (code), tester (test), reviewer (review code & bảo mật, read-only).~~ → thay bởi 2026-10-30 12:51

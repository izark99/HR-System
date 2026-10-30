# MEMORY — Nhật ký quyết định dự án

> Quy tắc ghi:
> - Mỗi quyết định ghi 1 dòng theo định dạng: `YYYY-MM-DD HH:MM - Quyết định` (giờ Việt Nam, UTC+7), **cách nhau 1 dòng trống** để hiển thị tách dòng khi đọc.
> - Các quyết định ghi lúc `2026-10-26 08:20` thực tế được chốt trong khoảng 07:40–08:20 (lịch sử commit đã được gộp nên không còn giờ chính xác).
> - Chỉ ghi quyết định **đã chốt** với Harold. Ý tưởng chưa chốt thì ghi vào mục "Câu hỏi mở" trong `docs/spec.md`.
> - **Không xóa** quyết định cũ. Khi thay đổi: thêm dòng mới, đánh dấu dòng cũ bằng `~~gạch ngang~~` kèm `→ thay bởi YYYY-MM-DD HH:MM`.
> - **Quyết định mới nhất đặt ở đầu** từng nhóm. Khi đổi quyết định, cập nhật luôn `docs/spec.md` cho khớp.

## Phạm vi & sản phẩm

2026-10-27 07:31 - Bước 3 gồm: Flow Designer (React Flow) với node `input.excel`, `control.compare`, `output.excel`, `output.preview` + DuckDB-WASM và nhóm transform cơ bản `transform.select`, `transform.filter`, `transform.sort`, `transform.join`, `transform.union`, `transform.groupBy`, `transform.dedupe`, `code.sql`; màn Version & hiệu lực (kèm diff); tự đăng xuất sau 8 giờ.

2026-10-27 07:31 - `transform.formula` (hàm Excel → SQL) làm ở bước 4, ngay sau bước 3.

~~2026-10-26 22:52 - Bước 3 gồm: Flow Designer (React Flow) với node `input.excel`, `control.compare`, `output.excel` + DuckDB-WASM và nhóm transform cơ bản `transform.select`, `transform.filter`, `transform.sort`, `transform.join`, `transform.union`, `transform.groupBy`, `transform.dedupe`, `code.sql`; màn Version & hiệu lực (kèm diff); tự đăng xuất sau 8 giờ. `transform.formula` (hàm Excel → SQL) chưa nằm trong bước 3.~~ → thay bởi 2026-10-27 07:31

2026-10-26 22:52 - Bảng tham chiếu (`ref_tables`, `ref_table_versions`), `templates` và node `input.refTable` để sang Phase 2.

2026-10-26 13:37 - Bước 2 (Supabase) gồm: đăng nhập/đổi mật khẩu, RLS, lưu flow/version (flow nạp bằng lệnh import JSON), run log metadata, màn Admin Users & Groups (tạo tài khoản, reset mật khẩu, khóa, gán flow). Màn Version & Flow Designer để bước 3.

2026-10-26 09:27 - Thứ tự làm Phase 1: (1) chạy được flow nghiệm thu trên trình duyệt (DAG executor + Web Worker + 3 màn User), (2) Supabase (auth, RLS, lưu flow/version), (3) Flow Designer Admin.

2026-10-26 08:20 - Python (Pyodide) và template Excel để sang Phase 2; MVP chỉ có Excel + SQL, output là preview + xuất Excel nhiều sheet cơ bản.

2026-10-26 08:20 - Flow dùng để nghiệm thu MVP: đối chiếu bảng lương – chấm công.

2026-10-26 08:20 - Quy mô dữ liệu tùy flow; thiết kế cho tối đa ~1 triệu dòng mỗi lần chạy.

2026-10-26 08:20 - Use case: cả làm sạch/đối chiếu/gộp file (xuất Excel) và báo cáo HR (bảng + chart); ưu tiên làm sạch/đối chiếu trước. Hệ thống phải linh hoạt tối đa để Admin cấu hình theo từng nhu cầu.

2026-10-26 08:20 - Xây webapp nội bộ xử lý dữ liệu Excel trực tiếp trên trình duyệt, dạng framework: Admin cấu hình flow, User chạy flow.

## Flow nghiệm thu: Đối chiếu bảng lương – chấm công

2026-10-26 09:12 - Rule `unique` trên cột khóa cũng không phân biệt hoa thường/khoảng trắng → báo trùng ngay ở bước kiểm tra file.

2026-10-26 08:59 - File có 2 cột trùng tên với cột bắt buộc → lỗi.

2026-10-26 08:59 - So khớp khóa (Mã NV) không phân biệt hoa thường, bỏ khoảng trắng thừa.

2026-10-26 08:59 - Sheet "Lệch": ô trống hiển thị để trống, nhưng vẫn tính là 0 khi so sánh.

2026-10-26 08:59 - File có header nhưng không có dòng dữ liệu → cảnh báo (warning).

2026-10-26 08:59 - Cột kiểu ngày luôn chấp nhận ô ngày thật của Excel, bất kể định dạng text đã cấu hình.

2026-10-26 08:59 - Cột kiểu text lấy đúng text đang hiển thị trong Excel (giữ "00123", ngày theo định dạng hiển thị).

2026-10-26 08:59 - Số dạng text có thể hiểu theo 2 cách (VD "1,500") → cảnh báo (warning).

2026-10-26 08:59 - File thiếu cột khóa: chỉ báo 1 lỗi "thiếu cột", không báo thêm lỗi từng dòng.

2026-10-26 08:59 - Bỏ qua dòng có cột khóa chứa text cấu hình được (VD "TỔNG CỘNG"), so khớp sau khi chuẩn hóa.

2026-10-26 08:41 - Ô chỉ tiêu (công, OT, phép, không lương) để trống được coi là 0; cột chỉ tiêu vẫn bắt buộc phải tồn tại trong file (thiếu cột → lỗi).

2026-10-26 08:20 - Dữ liệu test do Claude tự sinh (dữ liệu giả, `fixtures/payroll-timesheet/`), Harold review và chỉnh cấu trúc cho sát thực tế.

2026-10-26 08:20 - Đưa node `control.compare` lên MVP; output 1 file Excel 4 sheet: Tổng hợp / Lệch / Chỉ có trong lương / Chỉ có trong chấm công.

2026-10-26 08:20 - Khớp khi chênh lệch nằm trong ngưỡng (tolerance) do Admin cấu hình riêng cho từng chỉ tiêu.

2026-10-26 08:20 - Chỉ tiêu đối chiếu: ngày công, OT, nghỉ phép, nghỉ không lương (không kiểm tra số tiền).

2026-10-26 08:20 - Khóa đối chiếu là Mã NV, đồng nhất giữa 2 hệ thống (không cần chuẩn hóa/mapping).

2026-10-26 08:20 - Bảng lương và chấm công đều gồm nhiều file theo chi nhánh; input slot cho phép upload nhiều file và tự gộp (union) trước khi đối chiếu.

2026-10-26 08:20 - File chấm công dạng tổng hợp theo tháng, mỗi NV 1 dòng.

## Dữ liệu & tuân thủ

2026-10-27 07:31 - CSP giữ `style-src 'self' 'unsafe-inline'` (React Flow, Monaco gán style lúc chạy); script inline vẫn bị chặn. Quy tắc `data-privacy.md` sửa cho khớp.

2026-10-26 08:20 - Run log không chứa nội dung dữ liệu; tên file gốc chỉ lưu dạng hash SHA-256.

2026-10-26 08:20 - Admin được lưu bảng tham chiếu lên server nhưng chỉ dữ liệu KHÔNG mang tính cá nhân (danh mục, mapping mã, biểu thuế, hệ số).

2026-10-26 08:20 - Dữ liệu nhân sự không rời máy user; server chỉ lưu tài khoản, cấu hình flow, template, bảng tham chiếu, log metadata.

2026-10-26 08:20 - Không nhắc tên công ty của Harold trong dự án (code, tài liệu, dữ liệu mẫu, commit); dùng cách gọi chung.

## Hạ tầng

2026-10-27 07:31 - DuckDB-WASM tự host trên Cloudflare Pages: lúc build tách file `.wasm` (~34 MB, vượt giới hạn 25 MiB/file) thành các phần < 25 MiB; worker tải, kiểm tra checksum, ghép lại, cấp cho DuckDB qua URL `blob:` cục bộ; cache bằng Cache Storage. CSP thêm `blob:` vào `connect-src` (không thêm domain ngoài).

~~2026-10-26 22:52 - DuckDB-WASM tự host trên Cloudflare Pages: lúc build tách file `.wasm` (~34 MB, vượt giới hạn 25 MiB/file) thành các phần < 25 MiB; worker tải, kiểm tra checksum, ghép lại rồi khởi tạo; cache bằng Cache Storage. Không thêm domain ngoài, CSP giữ nguyên.~~ → thay bởi 2026-10-27 07:31

2026-10-26 20:27 - Giữ Supabase không bị pause bằng GitHub Actions chạy theo lịch mỗi ngày (`.github/workflows/keep-alive.yml`, chỉ dùng publishable key); bỏ Cloudflare Cron Worker.

2026-10-26 20:27 - `main` là nhánh production: Cloudflare Pages deploy từ `main`; code được đưa lên `main` sau khi qua test/review.

2026-10-26 13:37 - Deploy lên Cloudflare Pages ngay khi xong bước 2 để có link dùng thử; Harold tạo tài khoản Cloudflare và kết nối repo GitHub theo hướng dẫn.

2026-10-26 13:37 - Tài khoản Admin đầu tiên tạo bằng script seed (username `admin`, mật khẩu tạm gửi riêng cho Harold, bắt đổi ở lần đăng nhập đầu).

2026-10-26 13:37 - Supabase project `hr-data-flow` (ref `rzakjtgvbyxqsmbpcomw`), organization `izark99`, gói Free, region Singapore (`ap-southeast-1`); do Claude tạo qua kết nối Supabase.

~~2026-10-26 08:20 - Dùng Cloudflare Cron Worker ping Supabase hằng ngày để tránh project bị pause sau 7 ngày.~~ → thay bởi 2026-10-26 20:27

2026-10-26 08:20 - Hosting phải miễn phí: Cloudflare Pages (frontend) + Supabase Free (Auth, Postgres, Storage, Edge Functions). Không dùng Vercel Hobby vì cấm dùng thương mại.

## Xác thực & phân quyền

2026-10-27 12:30 - Tự đăng xuất (hết 8 giờ) dùng đăng xuất cục bộ (`scope: 'local'`): vẫn gọi server thu hồi refresh token của phiên trong tab này, không ảnh hưởng tab/máy khác; xóa session trong `sessionStorage` và chuyển trang ngay, không chờ server quá 3 giây.

~~2026-10-27 08:49 - Tự đăng xuất (hết 8 giờ) dùng đăng xuất toàn cục: thu hồi refresh token trên server, các phiên khác của cùng tài khoản cũng bị đăng xuất; mất mạng thì vẫn đăng xuất cục bộ.~~ → thay bởi 2026-10-27 12:30

2026-10-26 22:52 - Tự đăng xuất sau 8 giờ không thao tác: thao tác = chuột/phím/cuộn/chạm trong tab; khi flow đang chạy không tính là không thao tác; cảnh báo trước 5 phút với nút "Tiếp tục làm việc" (nêu rõ nếu Designer còn thay đổi chưa lưu); hết giờ đăng xuất và về màn đăng nhập kèm thông báo lý do.

2026-10-26 18:49 - Tài khoản bị khóa hoặc chưa có profile: hiện chung thông báo "Tài khoản bị khóa hoặc chưa được cấp quyền. Vui lòng liên hệ Admin."

2026-10-26 18:09 - Admin được tự reset mật khẩu, tự khóa, tự đổi role của chính mình (không chặn). Nếu Admin duy nhất tự khóa/hạ quyền, khôi phục bằng SQL trên Supabase dashboard.

2026-10-26 18:09 - Tự đăng xuất sau 8 giờ không thao tác: làm phía trình duyệt ở bước 3.

2026-10-26 18:09 - Admin thấy và chạy được mọi flow đã publish mà không cần tự gán cho mình.

2026-10-26 18:09 - Phiên đăng nhập lưu trong `sessionStorage` (đóng tab là phải đăng nhập lại).

2026-10-26 08:20 - Chỉ Admin được viết code SQL/Python.

2026-10-26 08:20 - User chỉ chạy flow (chọn flow → nhập tham số → upload → chạy → xem trước → tải về), không được chỉnh/clone flow.

2026-10-26 08:20 - 2 role: admin, user. Flow gán cho user hoặc group.

2026-10-26 08:20 - Đăng nhập bằng username + password do Admin cấp; bắt đổi mật khẩu lần đầu; Admin reset mật khẩu; không có 2FA; không public sign-up.

## Flow & xử lý

2026-10-29 21:18 - Designer: luôn cho lưu draft, kể cả khi chưa có node nào hoặc còn lỗi; lỗi chỉ chặn ở bước Publish.

2026-10-29 21:18 - Designer: nối cạnh chỉ bằng chuột ở bước 3 (React Flow không hỗ trợ bàn phím); cách nối bằng bàn phím làm ở R4 nếu còn hạn mức.

2026-10-27 13:06 - `transform.groupBy`: `min`/`max` trên cột chữ so theo mã ký tự (thứ tự nhị phân của DuckDB), không theo bảng chữ cái tiếng Việt; ghi rõ trong spec.

2026-10-27 07:31 - `transform.join`, `transform.dedupe` (`normalizeKeys`) và `transform.filter` (`normalizeText`) mặc định so khớp không phân biệt hoa thường, bỏ khoảng trắng thừa (giống `control.compare`); Admin tắt được.

2026-10-27 07:31 - `transform.sort` sắp chữ theo bảng chữ cái tiếng Việt (`Intl.Collator('vi')`).

2026-10-27 07:31 - Node `output.preview` có trong bước 3: bảng xem trước trong app, không cần xuất file.

2026-10-27 07:31 - Slot có `extraColumns: 'keep'`: cột thêm chỉ dùng được trong `code.sql` lúc chạy; Designer hiện cảnh báo.

2026-10-26 22:52 - Designer: form cấu hình input slot cho toàn bộ trường của schema (Admin không phải sửa JSON).

2026-10-26 22:52 - Designer: draft lưu bằng nút Lưu / Ctrl+S (không tự lưu); cảnh báo khi rời trang có thay đổi chưa lưu; khi lưu kiểm tra xung đột theo `updated_at` để không ghi đè bản người khác vừa lưu.

2026-10-26 22:52 - Designer: xem trước từng node bằng file mẫu (chỉ trong RAM, xử lý trong worker): chạy flow tới node đang chọn, hiện 200 dòng đầu (node compare hiện cả 4 bảng); danh sách cột ở mỗi node suy ra từ định nghĩa slot, không cần file mẫu.

2026-10-26 18:49 - Import flow JSON có `.csv` trong `accept`: tự bỏ `.csv` và lưu bản đã làm sạch lên server, báo cho Admin biết đã bỏ.

2026-10-26 13:08 - Định dạng mã (VD Mã NV) không fix cứng trong code: là cấu hình của Admin (rule regex tùy chọn trên từng cột của input slot). Flow nghiệm thu chỉ yêu cầu Mã NV bắt buộc + không trùng, không giới hạn độ dài.

2026-10-26 13:08 - Hủy khi dữ liệu lớn: chấp nhận khởi động lại worker và kiểm tra lại file (khoảng 6–8 giây) cho MVP.

2026-10-26 13:08 - Trang chạy flow có nút "Xem kết quả" khi kết quả của lần chạy trước còn trong bộ nhớ.

2026-10-26 13:08 - Mã trùng giữa 2 file: đánh dấu lỗi trên cả 2 file liên quan.

2026-10-26 13:08 - Không nhận file CSV: bỏ `.csv` khỏi danh sách định dạng nhận của input slot (chỉ .xlsx, .xls).

2026-10-26 13:08 - Tham số kiểu ngày trong tên file kết quả định dạng `YYYY-MM-DD`.

2026-10-26 12:37 - Tham số kiểu tháng trong tên file kết quả định dạng `YYYY-MM` (VD `DoiChieu_2026-09.xlsx`) để sắp xếp theo tên đúng thứ tự thời gian.

2026-10-26 08:20 - Output: xuất Excel nhiều sheet + preview/chart trong app + đổ dữ liệu vào template .xlsx do Admin upload.

2026-10-26 08:20 - Input slot do Admin định nghĩa (sheet, dòng header, alias tên cột, kiểu, rule validate); User nhận validation report trước khi chạy.

2026-10-26 08:20 - Hàm Excel được transpile sang SQL DuckDB để chạy nhanh; chỉ hỗ trợ hàm trong danh sách đã định nghĩa.

2026-10-26 08:20 - Xử lý dữ liệu hỗ trợ ngang hàng 3 ngôn ngữ: hàm Excel, SQL (DuckDB-WASM), Python (Pyodide).

2026-10-26 08:20 - Admin cấu hình flow bằng canvas kéo-thả node (React Flow); flow lưu dạng JSON (DAG).

## Versioning

2026-10-29 21:18 - Màn Version có nút "Xem trong Designer" (chỉ xem) cho version published/retired.

2026-10-27 08:49 - Hủy draft rồi tạo draft mới được phép dùng lại số version của draft đã hủy (draft chưa publish nên không có run log trỏ tới).

2026-10-26 22:52 - Diff version làm trong bước 3: liệt kê node thêm/xóa/sửa và cấu hình JSON side-by-side cho node bị sửa.

2026-10-26 08:20 - Version đã Published là bất biến; rollback = publish lại nội dung cũ thành version mới.

2026-10-26 08:20 - Bảng tham chiếu cũng quản lý theo effective date; khi chạy, flow và bảng tham chiếu được chọn theo cùng ngày tham chiếu (as-of date).

2026-10-26 08:20 - Flow có Draft/Published, lưu lịch sử version, rollback; quản lý hiệu lực theo effective date (effective_from / effective_to), không chồng lấn.

## Kỹ thuật & tổ chức

2026-10-30 12:51 - Đội agent theo mô hình generator–verifier: bỏ `requirements-analyst` (thay bằng skill `clarify` chạy trong session chính); gộp `tester` + `reviewer` thành `verifier` (test + review, chỉ viết file test); giữ `developer` cho vòng code lớn, sửa nhỏ session chính tự làm; giao việc kèm gói bối cảnh ngắn; mỗi lúc chỉ 1 subagent. Ghi trong `.claude/rules/workflow.md`.

~~2026-10-29 21:18 - Tester và reviewer chạy nối tiếp nhau (không song song) để tiết kiệm hạn mức; ghi trong `.claude/rules/workflow.md`.~~ → thay bởi 2026-10-30 12:51

2026-10-28 07:46 - Do hạn mức gói có hạn: từ sau các vòng đang chạy (R3, R1b), mỗi thời điểm chỉ 1 developer chạy, các vòng code làm tuần tự; ghi trong `.claude/rules/workflow.md`.

2026-10-27 17:50 - Engine chuyển bảng sang dạng cột (columnar, dựa trên Arrow) trong vòng riêng R1b, chạy song song với R3; bước 3 chỉ xong khi 1 triệu dòng × 30 cột chạy được không crash trên Chromium.

2026-10-27 17:50 - Không dùng `<select>` (dropdown) mặc định của trình duyệt ở mọi màn; dùng Select tự làm theo design system (tương tự DatePicker), hỗ trợ nhóm, tìm kiếm, bàn phím.

2026-10-27 07:36 - Ngân sách bundle: entry chunk (gzip) không tăng quá 10% so với cuối bước 2 (commit `d079f6b`); build tự kiểm tra và báo lỗi khi vượt.

2026-10-27 07:31 - Editor code trong Designer dùng Monaco (theo spec §5), chỉ tải trong chunk Designer, worker và font self-host.

2026-10-26 13:48 - Không dùng date/month picker mặc định của trình duyệt; dùng picker tự làm theo design system (tiếng Việt, "Tháng 10/2026", lưới 12 tháng, chọn bằng bàn phím được).

2026-10-26 13:18 - CLAUDE.md giữ ngắn gọn (tổng quan, nguồn sự thật, lệnh); quy tắc chi tiết tách vào `.claude/rules/*.md`, quy tắc theo vùng code chỉ nạp khi làm việc ở vùng đó.

2026-10-26 12:37 - Font Be Vietnam Pro được self-host trong app (không tải từ Google Fonts); CSP không cho phép domain font bên ngoài.

2026-10-26 09:24 - Nút chính dùng teal đậm #0F766E (đạt tương phản WCAG AA với chữ trắng); #14B8A6 chỉ dùng cho mảng màu/trang trí.

2026-10-26 09:24 - UI/UX đồng nhất theo design language "bright executive": font Be Vietnam Pro, nền sáng #F7FAF9, card trắng bo 20px + shadow nhẹ, eyebrow pill trên tiêu đề, màu theo ý nghĩa (teal = tốt/chính, coral = rủi ro/lỗi, amber = cảnh báo, blue = thông tin). Chi tiết token ở docs/spec.md §25.

2026-10-26 08:44 - Tài liệu dự án đặt trong `docs/` (spec.md, MEMORY.md); CLAUDE.md và README.md giữ ở root.

~~2026-10-26 08:20 - Team agent gồm: requirements-analyst (viết yêu cầu), developer (code), tester (test), reviewer (review code & bảo mật, read-only).~~ → thay bởi 2026-10-30 12:51

2026-10-26 08:20 - Dùng CLAUDE.md (hướng dẫn dự án) + MEMORY.md (nhật ký quyết định) + team agent trong `.claude/agents/`.

2026-10-26 08:20 - Giao diện tiếng Việt mặc định, có cấu trúc i18n để thêm tiếng Anh.

2026-10-26 08:20 - Stack: TypeScript + React + Vite + Tailwind + shadcn/ui; Harold tự maintain.

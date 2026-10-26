# MEMORY — Nhật ký quyết định dự án

> Quy tắc ghi:
> - Mỗi quyết định ghi 1 dòng theo định dạng: `YYYY-MM-DD HH:MM - Quyết định` (giờ Việt Nam, UTC+7), **cách nhau 1 dòng trống** để hiển thị tách dòng khi đọc.
> - Các quyết định ghi lúc `2026-10-26 08:20` thực tế được chốt trong khoảng 07:40–08:20 (lịch sử commit đã được gộp nên không còn giờ chính xác).
> - Chỉ ghi quyết định **đã chốt** với Harold. Ý tưởng chưa chốt thì ghi vào mục "Câu hỏi mở" trong `docs/spec.md`.
> - **Không xóa** quyết định cũ. Khi thay đổi: thêm dòng mới, đánh dấu dòng cũ bằng `~~gạch ngang~~` kèm `→ thay bởi YYYY-MM-DD HH:MM`.
> - **Quyết định mới nhất đặt ở đầu** từng nhóm. Khi đổi quyết định, cập nhật luôn `docs/spec.md` cho khớp.

## Phạm vi & sản phẩm

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

2026-10-26 08:20 - Run log không chứa nội dung dữ liệu; tên file gốc chỉ lưu dạng hash SHA-256.

2026-10-26 08:20 - Admin được lưu bảng tham chiếu lên server nhưng chỉ dữ liệu KHÔNG mang tính cá nhân (danh mục, mapping mã, biểu thuế, hệ số).

2026-10-26 08:20 - Dữ liệu nhân sự không rời máy user; server chỉ lưu tài khoản, cấu hình flow, template, bảng tham chiếu, log metadata.

2026-10-26 08:20 - Không nhắc tên công ty của Harold trong dự án (code, tài liệu, dữ liệu mẫu, commit); dùng cách gọi chung.

## Hạ tầng

2026-10-26 13:37 - Deploy lên Cloudflare Pages ngay khi xong bước 2 để có link dùng thử; Harold tạo tài khoản Cloudflare và kết nối repo GitHub theo hướng dẫn.

2026-10-26 13:37 - Tài khoản Admin đầu tiên tạo bằng script seed (username `admin`, mật khẩu tạm gửi riêng cho Harold, bắt đổi ở lần đăng nhập đầu).

2026-10-26 13:37 - Supabase project `hr-data-flow` (ref `rzakjtgvbyxqsmbpcomw`), organization `izark99`, gói Free, region Singapore (`ap-southeast-1`); do Claude tạo qua kết nối Supabase.

2026-10-26 08:20 - Dùng Cloudflare Cron Worker ping Supabase hằng ngày để tránh project bị pause sau 7 ngày.

2026-10-26 08:20 - Hosting phải miễn phí: Cloudflare Pages (frontend) + Supabase Free (Auth, Postgres, Storage, Edge Functions). Không dùng Vercel Hobby vì cấm dùng thương mại.

## Xác thực & phân quyền

2026-10-26 08:20 - Chỉ Admin được viết code SQL/Python.

2026-10-26 08:20 - User chỉ chạy flow (chọn flow → nhập tham số → upload → chạy → xem trước → tải về), không được chỉnh/clone flow.

2026-10-26 08:20 - 2 role: admin, user. Flow gán cho user hoặc group.

2026-10-26 08:20 - Đăng nhập bằng username + password do Admin cấp; bắt đổi mật khẩu lần đầu; Admin reset mật khẩu; không có 2FA; không public sign-up.

## Flow & xử lý

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

2026-10-26 08:20 - Version đã Published là bất biến; rollback = publish lại nội dung cũ thành version mới.

2026-10-26 08:20 - Bảng tham chiếu cũng quản lý theo effective date; khi chạy, flow và bảng tham chiếu được chọn theo cùng ngày tham chiếu (as-of date).

2026-10-26 08:20 - Flow có Draft/Published, lưu lịch sử version, rollback; quản lý hiệu lực theo effective date (effective_from / effective_to), không chồng lấn.

## Kỹ thuật & tổ chức

2026-10-26 13:48 - Không dùng date/month picker mặc định của trình duyệt; dùng picker tự làm theo design system (tiếng Việt, "Tháng 10/2026", lưới 12 tháng, chọn bằng bàn phím được).

2026-10-26 13:18 - CLAUDE.md giữ ngắn gọn (tổng quan, nguồn sự thật, lệnh); quy tắc chi tiết tách vào `.claude/rules/*.md`, quy tắc theo vùng code chỉ nạp khi làm việc ở vùng đó.

2026-10-26 12:37 - Font Be Vietnam Pro được self-host trong app (không tải từ Google Fonts); CSP không cho phép domain font bên ngoài.

2026-10-26 09:24 - Nút chính dùng teal đậm #0F766E (đạt tương phản WCAG AA với chữ trắng); #14B8A6 chỉ dùng cho mảng màu/trang trí.

2026-10-26 09:24 - UI/UX đồng nhất theo design language "bright executive": font Be Vietnam Pro, nền sáng #F7FAF9, card trắng bo 20px + shadow nhẹ, eyebrow pill trên tiêu đề, màu theo ý nghĩa (teal = tốt/chính, coral = rủi ro/lỗi, amber = cảnh báo, blue = thông tin). Chi tiết token ở docs/spec.md §25.

2026-10-26 08:44 - Tài liệu dự án đặt trong `docs/` (spec.md, MEMORY.md); CLAUDE.md và README.md giữ ở root.

2026-10-26 08:20 - Team agent gồm: requirements-analyst (viết yêu cầu), developer (code), tester (test), reviewer (review code & bảo mật, read-only).

2026-10-26 08:20 - Dùng CLAUDE.md (hướng dẫn dự án) + MEMORY.md (nhật ký quyết định) + team agent trong `.claude/agents/`.

2026-10-26 08:20 - Giao diện tiếng Việt mặc định, có cấu trúc i18n để thêm tiếng Anh.

2026-10-26 08:20 - Stack: TypeScript + React + Vite + Tailwind + shadcn/ui; Harold tự maintain.

# MEMORY — Nhật ký quyết định dự án

> Quy tắc ghi:
> - Mỗi quyết định ghi 1 dòng theo định dạng: `YYYY-MM-DD HH:MM - Quyết định` (giờ Việt Nam, UTC+7), **cách nhau 1 dòng trống** để hiển thị tách dòng khi đọc.
> - Các quyết định ghi lúc `2026-10-26 08:20` thực tế được chốt trong khoảng 07:40–08:20 (lịch sử commit đã được gộp nên không còn giờ chính xác).
> - Chỉ ghi quyết định **đã chốt** với Harold. Ý tưởng chưa chốt thì ghi vào mục "Câu hỏi mở" trong `docs/spec.md`.
> - **Không xóa** quyết định cũ. Khi thay đổi: thêm dòng mới, đánh dấu dòng cũ bằng `~~gạch ngang~~` kèm `→ thay bởi YYYY-MM-DD HH:MM`.
> - **Quyết định mới nhất đặt ở đầu** từng nhóm. Khi đổi quyết định, cập nhật luôn `docs/spec.md` cho khớp.

## Phạm vi & sản phẩm

2026-11-10 08:56 - Bảng tham chiếu vòng 2 (chấp nhận khác spec/mẫu): màn Chạy flow tải lười theo route (tách khỏi JS tải ban đầu để còn ngân sách); bảng tham chiếu thiếu phiên bản hiệu lực luôn khóa nút Chạy, kể cả bảng chỉ dùng cho tham số danh sách chọn không bắt buộc; vùng upload khi thiếu bảng dùng kiểu disabled sẵn có (không làm mờ 60% vì không đạt tương phản a11y). Mọi chỗ "Hiện thêm N dòng" (tab Văn bản giao diện, lưới dữ liệu bảng tham chiếu của Admin, hộp "Xem bảng") đổi thành phân trang 100 dòng/trang (dưới bảng: "Dòng a–b / tổng" + ‹ 1 … n ›; tìm/lọc về trang 1). Bảng có header nằm trên vùng cuộn dọc: header phủ cả cột thanh cuộn, thanh cuộn chỉ nằm dưới header (như header trang) — không để dải trắng cạnh header. Mẫu cập nhật https://claude.ai/artifact/WB8Ndbb5CXYgsr2muW5pET (bản 2) chờ duyệt.

2026-11-10 07:50 - Harold duyệt mẫu màn Chạy flow cho bảng tham chiếu (https://claude.ai/artifact/WB8Ndbb5CXYgsr2muW5pET): khung "Phiên bản áp dụng" liệt kê từng bảng "Tên · vN · từ ngày" + nút "Xem bảng"; thiếu phiên bản → khung lỗi nêu bảng, khóa nút Tiếp, mờ phần upload; hộp "Xem bảng" chỉ đọc (tìm không dấu, 100 dòng/lô + "Hiện thêm", không sửa/tải về). Bắt đầu vòng 2.

2026-11-10 07:47 - Bảng tham chiếu vòng 2: thiếu phiên bản hiệu lực của bảng tham chiếu thì báo ngay khi User chọn kỳ (khung "Phiên bản áp dụng"), khóa nút Chạy trước bước upload; bản published có ô không khớp kiểu (Admin đổi kiểu cột sau khi publish) → tự chuyển nếu được, không được thì chặn chạy và nêu bảng + phiên bản + cột; dữ liệu bảng tham chiếu chỉ giữ trong bộ nhớ tab (tải lại mỗi lần mở màn Chạy flow, không lưu trình duyệt); User xem được nội dung bảng tham chiếu đang áp dụng (nút "Xem bảng" mở danh sách dòng chỉ đọc) — mẫu Artifact duyệt trước khi code. PR dependabot để nguyên, gom vào vòng nâng thư viện sau Phase 2 (build + full E2E + ngân sách JS + ảnh so pixel trước khi merge).

2026-11-09 19:15 - Bảng tham chiếu vòng 1 (chấp nhận khác mẫu): hộp Import có lỗi thì chỉ hiện báo cáo + "chưa thay draft", không lỗi mới hiện xem trước 200 dòng; cảnh báo dữ liệu cá nhân trong hộp Import là checkbox xác nhận + nút (i) (màn Cột giữ khung cảnh báo); hàm RPC của bảng tham chiếu chạy `security invoker` như flow (hàm ghi audit xác nhận là definer, tự kiểm admin). Giữ bảng danh sách kéo ngang như quy tắc bảng Admin (không thu cột Phiên bản).

2026-11-09 14:38 - Harold duyệt mẫu màn Bảng tham chiếu (https://claude.ai/artifact/92KZJ49WJTdFoxWMo26kar, bản 2 đã sửa lỗi bố cục màn Designer); bắt đầu vòng 1.

2026-11-09 14:37 - Bảng tham chiếu (tiếp 14:28): import Excel vào draft thay toàn bộ dữ liệu draft; lưới sửa trong app có sửa ô, thêm/xóa dòng, tìm, Hoàn tác/Làm lại (Ctrl+Z/Y) và dán nhiều ô từ Excel; chia 2 vòng code: (1) database + RLS + màn Admin (danh sách, cột, phiên bản, import, lưới sửa), (2) node `input.refTable` + chọn version khi chạy + Designer + tham số `fromRefTable` — mỗi vòng developer → verifier → lên `main`. Mẫu Designer phải qua kiểm bố cục (không chồng lấn node/panel, không tràn, nhãn 1 dòng, giải thích sau (i)) như các lỗi đã sửa 2026-11-06.

2026-11-09 14:28 - Phase 2 bước 1 — bảng tham chiếu + `input.refTable`: dữ liệu lưu JSON trong `ref_table_versions.rows`, mỗi version ≤ 50.000 dòng và ≤ 5 MB; nhập bằng import Excel (đọc + kiểm cột/kiểu trong worker, xem trước rồi lưu thành version) **và** sửa từng ô ngay trong app (chỉ trên version draft); cột định nghĩa ở cấp bảng (mọi version cùng bộ cột: mã, tên, kiểu, tên cột trong file, cột khóa), đổi cột thì Designer kiểm lại các flow đang dùng; vòng đời version giống flow (Draft → Publish có hiệu lực từ ngày + ghi chú → Retired, không chồng lấn, bất biến, rollback = publish lại); Designer xem trước dùng version theo ngày hiệu lực của tham số mẫu (chưa nhập thì hôm nay); gộp tham số danh sách chọn lấy từ bảng tham chiếu (`fromRefTable`). Màn quản lý dựng mẫu Artifact cho Harold duyệt trước khi code.

~~2026-11-09 13:51 - Tab "Văn bản giao diện" (hiệu năng, verifier đo ~1.470 dòng chậm trên máy yếu): bảng hiện 100 dòng đầu, cuối bảng có nút "Hiện thêm 100 dòng (còn N)"; tìm/lọc vẫn chạy trên toàn bộ danh sách, số đếm giữ tổng; đổi ô tìm hoặc bộ lọc thì về lại 100 dòng đầu.~~ → thay bởi 2026-11-10 08:56

2026-11-09 13:06 - Tab "Văn bản giao diện": thứ tự cột của bảng là Màn, Mã, Trạng thái, Sửa lần cuối, Chữ đang dùng, Thao tác (cột chữ dài để cuối, liếc là thấy dòng đã sửa); chấp nhận người dùng đã đăng nhập đọc được `updated_by` (uuid của Admin, không kèm tên) của các dòng đã sửa.

2026-11-09 09:14 - Tab Admin "Văn bản giao diện" (menu trái): Admin sửa được **mọi text hiện có** của app: tên màn, menu, tiêu đề, nhãn, nút, thông báo của mọi màn User + Admin, Designer (kể cả bảng tra hàm công thức) và thông báo engine (kiểm tra file, lỗi chạy, lỗi cấu hình; text đã sửa được truyền vào worker). Không gồm dữ liệu do Admin đặt trong flow (tên flow, tên mục upload, tên sheet xuất…) — sửa ở Designer như cũ. Áp dụng chung cho mọi người dùng, kể cả màn Đăng nhập (bảng text đã sửa đọc được không cần đăng nhập vì chỉ chứa chữ giao diện, không dữ liệu cá nhân; chỉ Admin ghi). Chỉ chữ thuần (không HTML/link); chặn lưu khi thiếu/thừa biến `{{…}}`; độ dài ≤ 2 lần bản gốc (tối thiểu 40 ký tự); "Khôi phục mặc định" từng dòng và tất cả; lưu người sửa + thời điểm sửa gần nhất, không lịch sử phiên bản.

2026-11-09 09:12 - Tab "Văn bản giao diện" (duyệt mẫu https://claude.ai/artifact/XbyVkYNju69SB7pmvbAurb): bảng theo quy tắc bảng Admin hiện tại (mỗi ô 1 dòng, đủ chữ, kéo ngang; cột Màn, Mã, Chữ đang dùng, Trạng thái, Sửa lần cuối, Thao tác cố định phải: bút chì = Sửa, mũi tên vòng = Khôi phục mặc định); thanh lọc: Tìm (không phân biệt dấu), Màn (Select tự làm), "Chỉ dòng đã sửa", đếm dòng; nút "Khôi phục tất cả" ở header (ConfirmDialog). Sửa trong hộp thoại: bản gốc, ô chữ mới, biến bắt buộc đổi màu khi thiếu, đếm ký tự, lỗi tại chỗ chặn Lưu, xem trước với số liệu mẫu. Chữ mới: tab của Admin thấy ngay, người dùng khác thấy ở lần mở trang sau (không realtime).

~~2026-11-09 09:06 - Tab Admin "Văn bản giao diện" (menu trái): Admin sửa text tiếng Việt của mọi màn User + Admin và thông báo kiểm tra file / lỗi chạy mà User thấy (engine; text đã sửa được truyền vào worker); không gồm Designer và bảng tra hàm công thức. Áp dụng chung cho mọi người dùng, kể cả màn Đăng nhập (bảng text đã sửa đọc được không cần đăng nhập vì chỉ chứa chữ giao diện, không dữ liệu cá nhân; chỉ Admin ghi). Chỉ chữ thuần (không HTML/link); chặn lưu khi thiếu/thừa biến `{{…}}`; độ dài ≤ 2 lần bản gốc (tối thiểu 40 ký tự); "Khôi phục mặc định" từng dòng và tất cả; lưu người sửa + thời điểm sửa gần nhất, không lịch sử phiên bản.~~ → thay bởi 2026-11-09 09:14

2026-11-04 15:34 - Thứ tự Phase 2: (1) bảng tham chiếu có effective date (`ref_tables`, `ref_table_versions`) + node `input.refTable`; (2) `output.template` (template Excel); (3) `code.python` (Pyodide). Các node Phase 2 khác chưa xếp thứ tự.

2026-11-04 15:34 - Thứ tự sau vòng nâng tooling: bộ khung UI/UX vòng A → vòng B (gộp HANDOFF §4 mục #3: nối cạnh bằng bàn phím trong Designer) → so ảnh pixel → mục #5 tối ưu hiệu năng (vòng riêng, gồm thời gian đẩy dữ liệu vào DuckDB và đo AC-B4-31 trên Chromium) → Phase 2. HANDOFF §4 mục #1 đã xong ở bước 4 – R1; mục #2, #4 vẫn chấp nhận như cũ.

~~2026-10-30 17:32 - Vòng code đầu của bước 4 gộp thêm HANDOFF §4 mục #1 (giới hạn giải nén .xlsx: 2 GiB/entry; tỉ lệ nén ≤ 1:200 chỉ áp cho entry giải nén > 16 MiB, kèm giới hạn chống cộng dồn nhiều entry nhỏ; vượt → báo "file quá lớn"); mục #2, #4 giữ nguyên (chấp nhận); mục #3 (nối cạnh bằng bàn phím) và #5 (tối ưu hiệu năng, gồm thời gian đẩy dữ liệu vào DuckDB) làm vòng riêng sau `transform.formula`.~~ → thay bởi 2026-11-04 15:34

~~2026-10-30 13:18 - Vòng code đầu của bước 4 gộp thêm HANDOFF §4 mục #1 (giới hạn giải nén .xlsx: ~1 GB/entry, tỉ lệ nén ≤ 1:200, vượt → báo "file quá lớn"); mục #2, #4 giữ nguyên (chấp nhận); mục #3 (nối cạnh bằng bàn phím) và #5 (tối ưu hiệu năng) làm vòng riêng sau `transform.formula`.~~ → thay bởi 2026-10-30 17:32

2026-10-30 13:18 - `transform.formula` bản đầu không có XLOOKUP/VLOOKUP: tra cứu dùng `transform.join` (lấy đủ mọi dòng khớp). TEXT, NETWORKDAYS, TODAY, IFNA để sau.

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

2026-11-09 14:28 - Bảng tham chiếu: User chỉ đọc được bảng mà flow được gán cho họ dùng tới (danh sách bảng ghi lại khi Publish flow, đúng spec §7.3); import phát hiện cột có tên giống dữ liệu cá nhân (họ tên, CCCD, số điện thoại, email, mã NV…) → cảnh báo, Admin phải tick xác nhận "không phải dữ liệu cá nhân" mới lưu, xác nhận ghi audit (spec §17).

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

2026-11-09 07:34 - Thông báo lỗi Input slot / Tham số của kiểm tra thiết kế (Designer và kiểm tra trước Publish ở màn Version) gọi mục theo nhãn form (VD "Cột 1, Kiểu dữ liệu"), không lộ đường dẫn cấu hình nội bộ (HANDOFF §4.12a); làm trong vòng so ảnh pixel, trước khi sinh ảnh gốc.

2026-11-06 12:32 - Designer: nối cạnh bằng bàn phím: chọn node → nút "Nối tới…" trên thanh công cụ, phím tắt Ctrl+E, mở danh sách cổng đích có tìm kiếm (Select tự làm), Enter để nối; câu đọc cho trình đọc màn hình (`sr-only`, không hiển thị) là "Đã nối A → B" — ngoại lệ riêng của quy tắc §25.4 cho key `connectMenu.done`; nối bằng chuột giữ nguyên.

~~2026-11-06 08:24 - Designer: nối cạnh bằng bàn phím (vòng B của bộ khung UI/UX): chọn node → nút "Nối tới…" trên thanh công cụ (kèm phím tắt) mở danh sách cổng đích có tìm kiếm (Select tự làm), Enter để nối; thông báo cho trình đọc màn hình "Đã nối A → B"; nối bằng chuột giữ nguyên.~~ → thay bởi 2026-11-06 12:32

~~2026-11-04 15:34 - Designer: nối cạnh bằng bàn phím làm trong vòng B của bộ khung UI/UX (cách thao tác cụ thể chốt trước khi giao vòng B, spec Q27); bước 3 chỉ nối bằng chuột.~~ → thay bởi 2026-11-06 08:24

2026-10-30 17:32 - `transform.formula`: cảnh báo dòng lỗi (`rowErrors`) hiện cả trên node ở canvas (không chỉ panel xem trước); sửa trong vòng sửa R1.

2026-10-30 17:32 - `transform.formula`: chấp nhận 4 khác biệt: `^` với số mũ lấy từ cột dùng quy tắc 15 chữ số có nghĩa (số mũ là hằng nguyên vẫn chính xác); VALUE chỉ nhận dạng `1.5`/`1e3`, không nhận "1,500", "50%"; key cột bắt đầu bằng `_` bị cấm (`formula.error.reservedKey`); `type` `date`/`boolean` chỉ nhận biểu thức đúng kiểu đó (`decimal`/`integer`/`string` nhận mọi kiểu).

2026-10-30 17:32 - `transform.formula`: mục tiêu hiệu năng AC-B4-31 (≤ 2 giây cho 100k × 30, 5 cột công thức) chỉ tính thời gian chạy SQL công thức, không tính thời gian đẩy dữ liệu vào DuckDB.

2026-10-30 17:24 - `transform.formula` bản đầu hỗ trợ 41 hàm (40 hàm + PARAM; sửa số đếm sai "37", danh sách không đổi): IF, IFS, AND, OR, NOT, SWITCH, IFERROR, ISBLANK, ISNUMBER; ROUND, ROUNDUP, ROUNDDOWN, INT, ABS, MIN, MAX, MOD, SUM; LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, PROPER, CONCAT, TEXTJOIN, SUBSTITUTE, FIND, SEARCH, VALUE; DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, DATEDIF, WEEKDAY; PARAM.

2026-10-30 13:24 - `transform.formula`: dấu phân cách đối số là `,`, dấu thập phân là `.` (như Excel tiếng Anh / cách Excel lưu trong file); không nhận kiểu `;` của Excel vùng Việt Nam.

2026-10-30 13:18 - `transform.formula`: golden test lấy kết quả từ Excel thật: Claude sinh file .xlsx chứa công thức (dữ liệu giả), Harold mở bằng Excel, lưu lại và gửi về làm fixture.

2026-10-30 13:18 - `transform.formula` trong Designer: ô nhập Monaco (tô màu, gợi ý cột khi gõ `[`, gợi ý hàm + tooltip cú pháp, báo lỗi tại chỗ sau 300 ms), bảng tra "Hàm hỗ trợ", nút "Xem SQL đã sinh", xem trước bằng cơ chế xem trước node sẵn có.

2026-10-30 13:18 - `transform.formula`: số tính bằng `DECIMAL(38,10)` theo §9.4 (không dùng float); ROUND làm tròn kiểu Excel (half away from zero).

2026-10-30 13:18 - `transform.formula`: lỗi lúc chạy (#DIV/0!, #VALUE!…) xử lý theo tùy chọn từng cột: "để trống + cảnh báo" (mặc định; cảnh báo đếm số dòng theo loại lỗi, tối đa 5 số dòng, không kèm nội dung ô) hoặc "dừng chạy"; IFERROR luôn bắt được lỗi.

2026-10-30 13:18 - `transform.formula`: ô trống theo Excel: là 0 trong phép toán, "" khi nối chuỗi, ISBLANK đúng, `[A]=""` đúng; riêng công thức chỉ gồm tham chiếu cột (VD `=[A]`) với ô trống → kết quả trống.

2026-10-30 13:18 - `transform.formula`: 1 node nhiều cột công thức, tính tuần tự, cột sau dùng được cột trước; được ghi đè cột có sẵn; kiểu kết quả tự suy diễn, Admin sửa được.

2026-10-30 13:18 - `transform.formula`: tham chiếu cột gõ `[Tiêu đề]` hoặc `[key]` đều được; lưu chuẩn hóa thành `[key]`, hiển thị lại theo tiêu đề; 2 cột trùng tiêu đề → lỗi, yêu cầu dùng `[key]`.

2026-10-30 13:18 - `transform.formula`: người dùng chỉ viết công thức Excel, hệ thống tự transpile sang SQL DuckDB (không transpile sang Python); node không có chế độ viết SQL/Python (SQL dùng `code.sql`, Python dùng `code.python` ở Phase 2).

~~2026-10-30 13:18 - `transform.formula` bản đầu hỗ trợ 37 hàm: IF, IFS, AND, OR, NOT, SWITCH, IFERROR, ISBLANK, ISNUMBER; ROUND, ROUNDUP, ROUNDDOWN, INT, ABS, MIN, MAX, MOD, SUM; LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, PROPER, CONCAT, TEXTJOIN, SUBSTITUTE, FIND, SEARCH, VALUE; DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, DATEDIF, WEEKDAY; PARAM.~~ → thay bởi 2026-10-30 17:24

2026-10-29 21:18 - Designer: luôn cho lưu draft, kể cả khi chưa có node nào hoặc còn lỗi; lỗi chỉ chặn ở bước Publish.

~~2026-10-29 21:18 - Designer: nối cạnh chỉ bằng chuột ở bước 3 (React Flow không hỗ trợ bàn phím); cách nối bằng bàn phím làm ở R4 nếu còn hạn mức.~~ → thay bởi 2026-11-04 15:34

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

2026-11-09 10:20 - Khung cuộn (theo yêu cầu "freeze header, chỉ cuộn phần dưới" để header không hụt 10px ở mép phải): từ breakpoint `md` (768px) trở lên header cố định; Admin: menu trái cũng đứng yên, chỉ cột nội dung cuộn; màn User: vùng dưới header cuộn; thanh cuộn (10px, chừa chỗ) nằm trong vùng cuộn đó, trang (`html`) không cuộn. Dưới 768px (điện thoại, 390px) giữ cuộn cả trang như cũ (header cuộn đi). Ảnh so pixel: lúc chụp test tạm mở rộng vùng cuộn để chụp đủ nội dung. Không dựng mẫu Artifact; gửi Harold ảnh trước/sau từng màn trước khi lên `main`. Làm trong cùng vòng với sửa thanh cuộn (§32, commit `f0d5494` chưa lên `main`): developer → verifier, trước tab "Văn bản giao diện".

2026-11-09 09:06 - Thanh cuộn (theo yêu cầu "chuyển tab dài/ngắn không lệch ngang"): mọi vùng cuộn trong app luôn chừa chỗ thanh cuộn — cả trang (trừ Designer full-bleed, không cuộn trang) lẫn panel/bảng/danh sách bên trong (`scrollbar-gutter: stable`); mọi thanh cuộn (trang, vùng cuộn, Monaco) cùng một kiểu như panel Designer (10px, rãnh `#F1F5F9`, tay kéo `#475569`, hover `#1F2A44`), không dùng thanh mặc định của trình duyệt (Firefox chỉ đổi được bề dày + màu); `layout-lint` chặn thanh cuộn chưa có kiểu và kiểm bề ngang nội dung không đổi khi đổi tab. Giữ từ 2026-11-06 14:48: mỗi vùng chỉ 1 thanh cuộn theo mỗi chiều, `layout-lint` chặn vùng cuộn lồng nhau cùng chiều. Làm ngay sau vòng hiệu năng, session chính tự làm, gửi Harold ảnh trước/sau.

2026-11-09 09:06 - Thứ tự: vòng hiệu năng → sửa thanh cuộn → tab "Văn bản giao diện" (vòng riêng: mẫu Artifact duyệt trước → developer → verifier) → Phase 2. Tải text đã sửa mà làm JS tải ban đầu vượt ngân sách → dừng, báo Harold.

2026-11-09 08:03 - Vòng tối ưu hiệu năng (HANDOFF §4 mục #5): đo lại đủ 4 chặng (đọc .xlsx, đẩy vào DuckDB, SQL, ghi .xlsx) trên Chromium, chỉ tối ưu chặng đẩy dữ liệu vào DuckDB; số trước/sau đo trên Chromium của container, kèm lệnh đo để Harold tự chạy trên laptop thật cho kết luận AC-B3-24; giới hạn 1 vòng developer + 1 vòng verifier, không đạt thì dừng báo số liệu + hướng tiếp để Harold quyết; ràng buộc: kết quả flow nghiệm thu và golden test công thức giống hệt trước, JS tải ban đầu không tăng (chunk worker được tăng), không thêm dependency.

2026-11-09 07:34 - So ảnh pixel (spec §30.3): chỉ các trạng thái của `e2e/ui-v2.spec.ts` và `e2e/ui-v2-diacritics.spec.ts` (không thêm ảnh của `layout-lint`); ngưỡng 0 pixel; trạng thái động (skeleton, toast, đếm ngược, Monaco) được cố định trước khi so, nếu 2 lần chạy vẫn lệch thì trạng thái đó chỉ chụp để duyệt tay (`compare: false`, liệt kê trong spec); ảnh gốc commit thẳng vào repo (không dùng Git LFS), tổng vượt 20 MB thì dừng hỏi Harold. Session chính làm; `verifier` kiểm gói hẹp (review diff, chạy 2 lần liên tiếp, thử bỏ 1 dấu thanh phải fail, full E2E).

2026-11-06 18:27 - Bổ sung chống lỗi bố cục (theo yêu cầu "không để lỗi UI tương tự"): mọi nhóm tab (thường và dense) và lưới field không để 1 phần tử nằm lẻ ở hàng cuối; control xếp dọc trong một cột form/toolbar cùng bề rộng; nhãn checkbox cũng 1 dòng (nhãn dài rút gọn, phần chi tiết đưa vào (i)); nút (i) sát chữ nhãn (≤ 8px); chỉ 1 popover (i) mở mỗi lúc, Esc chỉ đóng popover không đóng dialog; tên file dài cắt "…" kèm tooltip; minimap Designer ẩn khi canvas thấp; node mới thêm không đè node có sẵn; lỗi cấu hình node không lộ key nội bộ và không lặp tên node.

~~2026-11-06 14:48 - Thanh cuộn của panel giữ như cũ (chỉ hiện khi cần, không chừa chỗ sẵn). Lỗi ở tab Input slot là 2 thanh cuộn lồng nhau (khung ngoài cuộn thêm vì nội dung panel vượt chiều cao khung): sửa tận gốc để mỗi vùng chỉ có 1 thanh cuộn theo mỗi chiều; `layout-lint` chặn vùng cuộn lồng nhau cùng chiều.~~ → thay bởi 2026-11-09 09:06

~~2026-11-06 14:45 - Mọi vùng cuộn trong app luôn chừa chỗ thanh cuộn (`scrollbar-gutter: stable`) để đổi tab/nội dung dài ngắn không làm lệch bố cục.~~ → thay bởi 2026-11-06 14:48

2026-11-06 14:45 - Gợi ý dưới field và đoạn giải thích trong form/card/panel (mọi màn) không hiện mặc định: hiện bằng nút (i) cạnh nhãn/tiêu đề, mở khi rê chuột, focus hoặc bấm (mobile: bấm); trình đọc màn hình vẫn đọc qua `aria-describedby`. Lỗi validate vẫn hiện tại chỗ. Mô tả dưới tiêu đề trang (`PageHeader`) giữ nguyên.

2026-11-06 14:45 - Nhãn field luôn 1 dòng, không xuống dòng: lưới form tự giảm số cột khi cột không đủ chỗ cho nhãn; ô số không hiện nút tăng/giảm mặc định của trình duyệt.

2026-11-06 13:05 - Theo phản hồi của Harold về panel phải Designer: control trong form dense cao 44px như bản thường (bỏ 42px, chỉ chữ 14px); tab trong `Tabs dense` chia đều bề ngang, cùng kích thước; `layout-lint` thêm luật: mọi control tương tác trong một panel/card/dialog cùng chiều cao (trừ nút nhỏ 36px có đánh dấu) và tab trong một nhóm cùng kích thước.

2026-11-06 12:32 - Lỗi bố cục UI (control cùng hàng lệch chiều cao/không thẳng hàng, tràn khỏi khung, chồng lấn, khoảng cách không đều, tab lệch kích thước, nhãn xuống dòng làm lệch hàng) không được lặp lại: thêm bộ kiểm hình học tự động trong E2E (`e2e/layout-lint`) chạy trên mọi màn, mọi trạng thái chụp ảnh và mọi form/tab cấu hình node của Designer, ở 1280×800, 1024×768 và 390×844 (màn User); vi phạm → E2E fail. Mọi vòng đổi UI phải pass bộ này; session chính tự soi ảnh từng màn trước khi gửi Harold duyệt.

2026-11-06 08:24 - Vòng B bộ khung UI/UX: bảng "Lần chạy gần đây" (Danh sách flow) chuyển sang `DataTable`; báo cáo kiểm tra file (`ValidationReport`) giữ bảng dense riêng (14px, như bảng Kết quả), thêm vào danh sách cho phép.

2026-11-06 08:24 - Vòng B bộ khung UI/UX: component dùng chung cũ (`Select`, `Tooltip`, `Menu`, picker, `Skeleton`, `ui.tsx`) sửa khoảng cách về thang 4·8·12·16·24·32·48·64 (lệch ≤ 2px), kiểm bằng ảnh duyệt tay.

2026-11-06 08:24 - Khoảng cách trong Designer (canvas, node, form cạnh canvas, panel dữ liệu) là ngoại lệ dense, ghi vào danh sách cho phép kèm lý do; phần khung Designer (thanh công cụ, dialog, toast) theo thang chuẩn.

2026-11-04 15:16 - Ngân sách bundle: JS tải ban đầu (gzip) = entry chunk + các chunk tải ngay cùng entry (`<link rel="modulepreload">`, vì Vite 8/Rolldown tách phần dùng chung ra khỏi entry) không tăng quá 10% so với cuối bước 2 (commit `d079f6b`, baseline giữ nguyên); build tự kiểm tra và báo lỗi khi vượt.

2026-11-04 15:16 - So ảnh pixel (`toHaveScreenshot`) hoãn tới sau vòng B của bộ khung UI/UX (tránh chụp lại ảnh gốc nhiều lần); code đã làm và kiểm (ngưỡng 0 pixel, đồng hồ trình duyệt cố định, cố định chữ thời gian chạy) lưu ở `docs/patches/2026-11-04-pixel-compare.patch`.

2026-11-04 15:16 - `@playwright/test` giữ 1.64.1 như đã lên `main` (chạy trên Chromium rev 1243 cài sẵn qua `executablePath`, full E2E pass); dependabot bỏ qua `@playwright/test`, chỉ nâng tay kèm full E2E khi Chromium môi trường đổi.

2026-11-04 15:16 - Hai session làm trùng vòng nâng tooling: giữ bản trên `main` (`fbc21f0`); nhánh của session kia chỉ chuyển thêm phần riêng (ngân sách, dependabot, tài liệu).

2026-11-04 14:16 - Thứ tự vòng: làm vòng nâng tooling (MEMORY 2026-11-03 09:01) trước, rồi mới tới bộ khung UI/UX (spec §29: vòng A dựng token + component, vòng B chuyển màn).

2026-11-04 14:12 - Bộ khung UI/UX (duyệt mẫu https://claude.ai/artifact/Cr36HRRwnWh3VHn5tJY587): thêm lớp layout + pattern dùng chung rồi chuyển các màn sang (không viết lại toàn bộ, không đổi nghiệp vụ). Layout: `PageShell` (content 1280 / fluid / narrow 488), `SideNavLayout`, `PageHeader` (workspace / showcase), `Section`, `Toolbar`. Pattern: `Tabs` (APG), `DataTable` (bảng Admin), `FormField`, `EmptyState`, `ToastProvider` toàn app, `Dialog` + `ConfirmDialog` (chuyển vào `components/`), `KpiCard`, `Stepper`, icon gom một chỗ. Màn mới không tự viết `<main>`, tabs, bảng Admin, field, toast. Chi tiết docs/spec.md §25.5, §29.

2026-11-04 14:12 - Thang chiều cao cho công cụ làm việc, bỏ thang tiêu đề lớn của `docs/design-reference.md` (file đó là trang marketing): tiêu đề trang workspace (Admin, Version, Form) 28/36 600; tiêu đề showcase (Kết quả, Danh sách flow, Đăng nhập) 32/40 600; mobile 24/32; số KPI 40/44 600 (mobile 32/36); mô tả dưới tiêu đề và chữ trong input 16px; nút chuẩn 44px chữ 16px/600; input/Select/picker 44px; nút nhỏ 36px; dòng bảng Admin 48px, header bảng 44px; khoảng cách trên trang 24px. Tiêu đề chứa tên do người dùng đặt vẫn 1 dòng cắt "…", hiện đủ khi rê chuột/focus. Giữ eyebrow + subtitle ở mọi tiêu đề trang (header workspace ≈ 90px).

2026-11-04 14:12 - Giữ nguyên từ bản 2: bộ màu teal/coral/amber/blue, font Be Vietnam Pro (400/500/600/700, bỏ 800), card bo 12px viền 1px #E2E8F0 không shadow (lớp nổi giữ shadow nhẹ), input bo 6px, nút 5 loại bo 12px (chính teal #0F766E, tối #1F2A44, outline viền #1F2A44, chữ, nguy hiểm), eyebrow 14px/500 in hoa giãn chữ 1px không nền, `title-md` 24/600, `title-sm` 20/700, body 16px, menu trái vạch trái 3px, trang đăng nhập nền phẳng. Khoảng cách chỉ dùng thang 4·8·12·16·24·32·48·64 (test chặn giá trị ngoài thang, ngoại lệ có lý do).

2026-11-04 14:12 - Màn User bỏ menu trái: mọi màn User căn giữa 1280px; Đổi mật khẩu vào từ menu tài khoản. Màn Chạy flow: stepper gọn 1 dòng (Tham số → Tải file & kiểm tra → Chạy → Kết quả), nút chính nằm ở thanh dính đáy màn hình.

2026-11-04 14:12 - Bảng Admin: dòng cao 48px (thay 56px); giữ biểu tượng bút chì = Sửa / Mở Designer, con mắt = Xem trong Designer, chồng lớp = Mở trang phiên bản; cột Phiên bản ở màn Flows hiện 2 phiên bản mới nhất kèm "từ dd/MM/yyyy" (+N); thanh cuộn mảnh 10px, rãnh `#F1F5F9`, tay kéo `#475569`, hover `#1F2A44`.

2026-11-04 13:39 - Vòng nâng tooling: session chính tự làm và tự chạy đủ check + full E2E; `verifier` kiểm gói hẹp (review diff, CSP, tách file .wasm, Monaco chỉ trong chunk Designer, ngân sách) trước khi lên `main`.

2026-11-04 13:39 - Nâng tooling làm cho entry JS hoặc CSS vượt ngân sách +10% (minifier mới Oxc, Lightning CSS) → dừng, báo Harold số liệu trước/sau; không tự đổi minifier, không tự đo lại baseline.

2026-11-04 13:39 - Vitest 5: giữ mặc định mới `clearMocks: true`, sửa các test ghi lời gọi mock ngoài thân test (VD trong `beforeAll`).

~~2026-11-04 13:39 - So ảnh pixel (`toHaveScreenshot`) cho toàn bộ các trạng thái của `e2e/ui-v2.spec.ts`, làm ngay sau vòng nâng tooling: ảnh gốc sinh trên Chromium cài sẵn và commit vào repo; đổi giao diện hoặc đổi Chromium thì cập nhật ảnh gốc trong cùng commit. Vẫn giữ trang ảnh duyệt tay và kiểm giá trị CSS.~~ → thay bởi 2026-11-04 15:16

~~2026-11-04 13:39 - Dependabot: merge bản vá/bản nhỏ khi CI xanh. Vòng nâng tooling nâng trực tiếp trên nhánh làm việc (mỗi gói 1 commit; PR dependabot tự đóng khi `main` có bản mới): vite 8 cùng @vitejs/plugin-react 6 (bỏ luật ignore), vitest 5. `@playwright/test` giữ 1.63.0 vì 1.64 cần Chromium 156 (rev 1248) còn môi trường cài sẵn Chromium 153 (rev 1243); dependabot bỏ qua `@playwright/test` cho tới khi Chromium của môi trường được nâng; đóng PR #9. Bỏ qua major của `@types/node` (runtime Node 22) và `apache-arrow` (theo DuckDB-WASM).~~ → thay bởi 2026-11-04 15:16

~~2026-11-03 16:22 - Duyệt mẫu bảng Admin (https://claude.ai/artifact/AwjFJEPc5YndnE6Z1tf56B): dòng cao 56px; biểu tượng bút chì = Sửa / Mở Designer, con mắt = Xem trong Designer, chồng lớp = Mở trang phiên bản; cột Phiên bản ở màn Flows hiện 2 phiên bản mới nhất kèm ngày "từ dd/MM/yyyy" ngay trong ô (+N cho phần còn lại). Thanh cuộn của mọi vùng cuộn trong app đồng bộ: mảnh 10px, rãnh `#F1F5F9`, tay kéo bo tròn `#475569`, hover `#1F2A44`.~~ → thay bởi 2026-11-04 14:12

2026-11-03 16:06 - Bảng Admin (Users, Nhóm, Flows, Version): mọi dòng cùng chiều cao, mỗi ô 1 dòng nhưng hiện đủ chữ (không cắt "…"); bảng rộng hơn card thì kéo ngang trong card; cột Thao tác cố định ở mép phải (có vạch ngăn trái), các cột còn lại cuộn. Nhiều chip trong 1 ô nằm cùng 1 hàng.

2026-11-03 15:32 - Cột Thao tác của mọi bảng Admin dùng nút biểu tượng cho gọn: 1 nút biểu tượng cho thao tác hay dùng (Users/Nhóm "Sửa" = bút chì; Flows "Mở trang phiên bản" = biểu tượng danh sách phiên bản; Version draft "Mở Designer" = bút chì; Version published/retired "Xem trong Designer" = con mắt) + nút "⋯" mở menu "Thao tác khác" (menu giữ chữ; Publish là mục đầu menu của dòng draft; thao tác nguy hiểm cuối menu, chữ coral, giữ hộp xác nhận). Nút biểu tượng 36px, SVG inline, có `aria-label` nêu tên dòng + tooltip chữ; bàn phím theo APG menu button.

~~2026-11-03 15:18 - Bảng Admin (Users, Nhóm, Flows, Version): mọi dòng cùng chiều cao; mỗi ô 1 dòng, chữ dài cắt "…" và hiện đủ khi rê chuột/focus; nhiều chip trong 1 ô nằm cùng 1 hàng; bảng vừa chiều ngang card ở 1280px (cột Thao tác không che cột khác), cột Thao tác có vạch ngăn bên trái như bảng Flows.~~ → thay bởi 2026-11-03 16:06

~~2026-11-03 14:53 - Màn Admin (Users & Groups, Nhóm, Flows, Version): chip trạng thái, menu trái ("Sắp có"), nhãn nút không xuống dòng vỡ bố cục. Cột Thao tác dùng chung cho mọi bảng Admin: 1 nút chữ (`button-text` của `docs/design-reference.md`: không viền, 14,4px/700, hover nền `#F1F5F9`, vùng bấm cao 36px) cho thao tác hay dùng + nút chữ "Thao tác khác ▾" mở menu (bàn phím theo APG menu button) chứa phần còn lại; thao tác nguy hiểm (Khóa, Retire, Hủy draft…) ở cuối menu, chữ coral, giữ hộp xác nhận. Nút hiện sẵn: Users "Sửa"; Nhóm "Sửa"; Flows "Mở trang phiên bản"; Version draft "Mở Designer" (Publish là mục đầu của menu, giống kiểu bảng Flows: chỉ nút chữ, không có nút teal trong bảng); Version published/retired "Xem trong Designer".~~ → thay bởi 2026-11-03 15:32

2026-11-03 13:28 - Hoạt ảnh loading dạng khung xương (skeleton): khối `#F1F5F9` theo bố cục sắp hiện, vệt sáng lướt chậm (~1,5 giây/lượt), chỉ hiện khi chờ quá ~200ms; `prefers-reduced-motion` → khối tĩnh; trình đọc màn hình vẫn đọc "Đang tải…". Áp cho mọi chỗ đang hiện "Đang tải…" và lúc chuyển trang chờ tải code (VD Designer); thanh % tải bộ xử lý dữ liệu giữ nguyên. Làm gộp trong vòng sửa giao diện bản 2 đang chạy.

~~2026-11-03 13:24 - Màn Admin (Users & Groups, Nhóm, Flows, Version): chip trạng thái, menu trái ("Sắp có"), nhãn nút không xuống dòng vỡ bố cục. Cột Thao tác dùng chung cho mọi bảng Admin: 1 nút chữ (`button-text` của `docs/design-reference.md`: không viền, 14,4px/700, hover nền `#F1F5F9`, vùng bấm cao 36px) cho thao tác hay dùng + nút chữ "Thao tác khác ▾" mở menu (bàn phím theo APG menu button) chứa phần còn lại; thao tác nguy hiểm (Khóa, Retire, Hủy draft…) ở cuối menu, chữ coral, giữ hộp xác nhận. Nút hiện sẵn: Users "Sửa"; Nhóm "Sửa"; Flows "Mở trang phiên bản"; Version draft "Mở Designer" + "Publish" (nút chính teal cỡ nhỏ); Version published/retired "Xem trong Designer".~~ → thay bởi 2026-11-03 14:53

2026-11-03 13:24 - Màn Users & Groups: form tạo tài khoản chuyển vào dialog mở từ nút "+ Tạo tài khoản"; bảng chiếm đủ chiều ngang.

~~2026-11-03 10:51 - Màn Admin (Users & Groups, Nhóm, Flows, Version): chip trạng thái, menu trái ("Sắp có"), nhãn nút không xuống dòng vỡ bố cục. Cột Thao tác dùng chung cho mọi bảng Admin: 1 nút nhỏ viền 36px cho thao tác hay dùng + nút "Thao tác khác ▾" mở menu (bàn phím theo APG menu button) chứa phần còn lại; thao tác nguy hiểm (Khóa, Retire, Hủy draft…) ở cuối menu, chữ coral, giữ hộp xác nhận. Nút hiện sẵn: Users "Sửa"; Nhóm "Sửa"; Flows "Mở trang phiên bản"; Version draft "Mở Designer" + "Publish" (nút chính); Version published/retired "Xem trong Designer".~~ → thay bởi 2026-11-03 13:24

~~2026-11-03 10:49 - Tiêu đề trang giữ cao dòng bằng cỡ chữ (48/48, mobile 32/32); tiêu đề chứa tên do người dùng đặt (tên flow, tên version…) giới hạn 1 dòng, cắt bằng "…", hiện đủ tên khi rê chuột/focus (tránh dấu tiếng Việt chồng dòng).~~ → thay bởi 2026-11-04 14:12

2026-11-03 10:49 - Màn Kết quả: tiêu đề "khớp toàn bộ" chỉ khi lệch = 0 và không có nhân viên chỉ có ở một file; còn lại dùng "Kỳ … có N nhân viên cần xử lý" với N = lệch + chỉ có trong lương + chỉ có trong chấm công (khớp số của card tối; card tối giữ phần chi tiết).

2026-11-03 10:49 - Màu nền khi rê chuột của nút: chính `#115E59`, tối `#334155` (chữ trắng ≥ 7:1) là ngoại lệ được phép đặt chữ trắng, chỉ cho trạng thái hover/active.

2026-11-03 10:49 - Thanh công cụ Designer dùng nút nhỏ 36px, 1 hàng; Hoàn tác/Làm lại/Sao chép/Dán/Xóa là nút biểu tượng có nhãn a11y + tooltip.

2026-11-03 10:49 - Palette node của Designer: mọi item cùng kích thước; tên và mô tả mỗi thứ 1 dòng, chữ dài cắt bằng "…", mô tả đầy đủ hiện khi rê chuột/focus.

~~2026-11-03 10:49 - Màn Admin (Users & Groups, Version…): chữ trong chip trạng thái, menu trái ("Sắp có"), nhãn nút không bị xuống dòng vỡ bố cục; cột Thao tác dùng chung một kiểu cho mọi bảng Admin (kiểu cụ thể: câu hỏi mở Q25 trong spec).~~ → thay bởi 2026-11-03 10:51

~~2026-11-03 10:13 - UI/UX đồng nhất theo design language "bright executive" bản 2 (phong cách phẳng), cấu trúc lấy đúng số của `docs/design-reference.md`: giữ nguyên bộ màu (nền #F7FAF9, card trắng; teal = tốt/chính, coral = rủi ro/lỗi, amber = cảnh báo, blue = thông tin) và font Be Vietnam Pro; tiêu đề lớn (`display-xl` 56/56, `display-lg` 48/48) weight 500, `title-md` 24px/600, `title-sm` 20px/700, eyebrow 14px/500 giãn chữ 1px không nền, nút 18px/600 lh 27px, nút nhỏ 14,4px/700; card bo 12px, viền 1px #E2E8F0, không shadow (popover/modal/toast giữ shadow nhẹ); input bo 6px; nút 3 cấp bo 12px cao 48px (chính teal #0F766E, tối #1F2A44, outline viền #1F2A44); menu trái mục đang chọn có vạch màu bên trái; body 16px; trang đăng nhập nền phẳng + card có viền. Font tự host thêm lại weight 500, vẫn bỏ 800; ngân sách CSS gzip +10% giữ nguyên. Chi tiết token ở docs/spec.md §25.~~ → thay bởi 2026-11-04 14:12

2026-11-03 10:13 - Chấp nhận các chỉnh sửa a11y của vòng giao diện: lưới chọn tháng hiện "Tháng 1"…"Tháng 12" (tên đọc phải chứa chữ hiển thị, WCAG 2.5.3); nút "Reset MK" đổi thành "Reset mật khẩu"; tiêu đề trên thanh của Designer giữ 20px để không mất diện tích canvas.

~~2026-11-03 10:06 - Design language tham chiếu là file `docs/design-reference.md` (Harold gửi): chỉ lấy phần cấu trúc (bo góc, nút, thang chữ, eyebrow, khoảng cách); giữ bộ màu teal/coral/amber/blue và font Be Vietnam Pro theo §25; chữ thường (body) giữ 16px (file dùng 18px).~~ → thay bởi 2026-11-04 14:12

2026-11-03 09:07 - Vòng giao diện bản 2: kiểm bằng ảnh chụp E2E (~20 trạng thái, dữ liệu giả) gom vào một trang xem ảnh để Harold duyệt tay, kèm kiểm tự động giá trị CSS thật (bo góc, cỡ chữ, tương phản); không so pixel (`toHaveScreenshot`) ở vòng này, cân nhắc lại sau vòng nâng tooling.

2026-11-03 09:07 - Vòng giao diện bản 2 gồm cả Designer nhưng chỉ đổi phần khung (bo góc, viền, nút, tiêu đề); chữ trong canvas, form cấu hình, Monaco giữ 14px.

2026-11-03 09:07 - Thêm `@axe-core/playwright` (MPL-2.0, chỉ dev dependency, không vào bundle) để quét a11y tự động trong E2E; Harold đồng ý ngoại lệ license.

2026-11-03 09:07 - Tiêu đề trang dạng câu kết luận chỉ áp dụng màn Kết quả (có số động, VD "Kỳ 09/2026 có 9 nhân viên lệch công"); màn Kết quả thêm KPI card (vạch trên 4px, số `display-xl`) và 1 card tối cho kết luận chính. Các màn khác giữ tiêu đề hiện tại.

~~2026-11-03 09:07 - Bỏ font weight 800 (và 500 nếu không còn dùng); script ngân sách bundle thêm kiểm CSS gzip không tăng quá 10% so với `main` trước vòng giao diện.~~ → thay bởi 2026-11-03 10:13

~~2026-11-03 09:01 - Dependabot: merge bản vá/bản nhỏ khi CI xanh; bản major của tooling (vite 8 cùng @vitejs/plugin-react 6, vitest 5, @playwright/test mới — cần khớp Chromium cài sẵn) gom vào một vòng "nâng tooling" riêng ngay sau vòng đổi giao diện, chạy đủ E2E; các PR #9, #11, #13 để mở tới lúc đó. Bỏ qua major của `@types/node` (runtime Node 22) và `apache-arrow` (theo DuckDB-WASM).~~ → thay bởi 2026-11-04 13:39

2026-10-30 23:29 - Giải nén entry .xlsx: đường đồng bộ dùng `fflate` (MIT, giải nén theo luồng, dừng sớm được) thay bộ giải mã DEFLATE tự viết; đường bất đồng bộ (worker) giữ bộ giải nén có sẵn của trình duyệt (`DecompressionStream`) kèm đếm byte và dừng sớm.

~~2026-10-30 22:59 - Giải nén entry .xlsx (đường đồng bộ và bất đồng bộ có giới hạn) dùng thư viện `fflate` (MIT, giải nén theo luồng, dừng sớm được), không dùng bộ giải mã DEFLATE tự viết.~~ → thay bởi 2026-10-30 23:29

2026-10-30 13:29 - Ngoại lệ thang chữ lớn: canvas Designer, ô Monaco/công thức và bảng xem trước dữ liệu giữ chữ 14px; phần còn lại theo §25.1.

2026-10-30 13:26 - Quy tắc frontend đổi tên `.claude/rules/frontend.md` → `.claude/rules/design.md` (UI, design system, i18n, a11y).

2026-10-30 13:26 - Đổi giao diện theo design language bản 2 làm vòng code riêng, ngay sau vòng R1 của `transform.formula`.

~~2026-10-30 13:26 - UI/UX đồng nhất theo design language "bright executive" bản 2 (phong cách phẳng): giữ nguyên bộ màu (nền #F7FAF9, card trắng; teal = tốt/chính, coral = rủi ro/lỗi, amber = cảnh báo, blue = thông tin) và font Be Vietnam Pro (tiêu đề weight 600); card bo 12px, viền 1px #E2E8F0, không shadow (popover/modal/toast giữ shadow nhẹ); input bo 6px; nút 3 cấp bo 12px cao 48px (chính teal #0F766E, tối #1F2A44, outline viền #1F2A44); eyebrow chữ in hoa giãn chữ, không nền; menu trái mục đang chọn có vạch màu bên trái; thang chữ lớn (body 16–18px, tiêu đề trang 48px); trang đăng nhập nền phẳng + card có viền. Chi tiết token ở docs/spec.md §25.~~ → thay bởi 2026-11-03 10:13

2026-10-30 12:51 - Đội agent theo mô hình generator–verifier: bỏ `requirements-analyst` (thay bằng skill `clarify` chạy trong session chính); gộp `tester` + `reviewer` thành `verifier` (test + review, chỉ viết file test); giữ `developer` cho vòng code lớn, sửa nhỏ session chính tự làm; giao việc kèm gói bối cảnh ngắn; mỗi lúc chỉ 1 subagent. Ghi trong `.claude/rules/workflow.md`.

~~2026-10-29 21:18 - Tester và reviewer chạy nối tiếp nhau (không song song) để tiết kiệm hạn mức; ghi trong `.claude/rules/workflow.md`.~~ → thay bởi 2026-10-30 12:51

2026-10-28 07:46 - Do hạn mức gói có hạn: từ sau các vòng đang chạy (R3, R1b), mỗi thời điểm chỉ 1 developer chạy, các vòng code làm tuần tự; ghi trong `.claude/rules/workflow.md`.

2026-10-27 17:50 - Engine chuyển bảng sang dạng cột (columnar, dựa trên Arrow) trong vòng riêng R1b, chạy song song với R3; bước 3 chỉ xong khi 1 triệu dòng × 30 cột chạy được không crash trên Chromium.

2026-10-27 17:50 - Không dùng `<select>` (dropdown) mặc định của trình duyệt ở mọi màn; dùng Select tự làm theo design system (tương tự DatePicker), hỗ trợ nhóm, tìm kiếm, bàn phím.

~~2026-10-27 07:36 - Ngân sách bundle: entry chunk (gzip) không tăng quá 10% so với cuối bước 2 (commit `d079f6b`); build tự kiểm tra và báo lỗi khi vượt.~~ → thay bởi 2026-11-04 15:16

2026-10-27 07:31 - Editor code trong Designer dùng Monaco (theo spec §5), chỉ tải trong chunk Designer, worker và font self-host.

2026-10-26 13:48 - Không dùng date/month picker mặc định của trình duyệt; dùng picker tự làm theo design system (tiếng Việt, "Tháng 10/2026", lưới 12 tháng, chọn bằng bàn phím được).

2026-10-26 13:18 - CLAUDE.md giữ ngắn gọn (tổng quan, nguồn sự thật, lệnh); quy tắc chi tiết tách vào `.claude/rules/*.md`, quy tắc theo vùng code chỉ nạp khi làm việc ở vùng đó.

2026-10-26 12:37 - Font Be Vietnam Pro được self-host trong app (không tải từ Google Fonts); CSP không cho phép domain font bên ngoài.

2026-10-26 09:24 - Nút chính dùng teal đậm #0F766E (đạt tương phản WCAG AA với chữ trắng); #14B8A6 chỉ dùng cho mảng màu/trang trí.

~~2026-10-26 09:24 - UI/UX đồng nhất theo design language "bright executive": font Be Vietnam Pro, nền sáng #F7FAF9, card trắng bo 20px + shadow nhẹ, eyebrow pill trên tiêu đề, màu theo ý nghĩa (teal = tốt/chính, coral = rủi ro/lỗi, amber = cảnh báo, blue = thông tin). Chi tiết token ở docs/spec.md §25.~~ → thay bởi 2026-10-30 13:26

2026-10-26 08:44 - Tài liệu dự án đặt trong `docs/` (spec.md, MEMORY.md); CLAUDE.md và README.md giữ ở root.

~~2026-10-26 08:20 - Team agent gồm: requirements-analyst (viết yêu cầu), developer (code), tester (test), reviewer (review code & bảo mật, read-only).~~ → thay bởi 2026-10-30 12:51

2026-10-26 08:20 - Dùng CLAUDE.md (hướng dẫn dự án) + MEMORY.md (nhật ký quyết định) + team agent trong `.claude/agents/`.

2026-10-26 08:20 - Giao diện tiếng Việt mặc định, có cấu trúc i18n để thêm tiếng Anh.

2026-10-26 08:20 - Stack: TypeScript + React + Vite + Tailwind + shadcn/ui; Harold tự maintain.

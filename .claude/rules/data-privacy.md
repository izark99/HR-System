# Dữ liệu & bảo mật (bất di bất dịch)

- **Không bao giờ gửi nội dung file Excel/dữ liệu nhân sự ra khỏi trình duyệt**: không upload, không log (kể cả console), không telemetry, không lưu localStorage/IndexedDB/URL. Đọc và xử lý file chỉ trong Web Worker.
- Server (Supabase) chỉ lưu: tài khoản, cấu hình flow/version, template, bảng tham chiếu **không chứa dữ liệu cá nhân**, run log metadata (tên file gốc lưu dạng hash SHA-256, không lưu nội dung hay text lỗi thô).
- Mọi bảng Supabase bật RLS; client không bao giờ dùng service role key.
- Tham số User nhập chỉ bind dưới dạng giá trị (prepared statement / dict), không nối chuỗi vào SQL/Python.
- CSP: `connect-src` chỉ app + Supabase; `font-src`/`style-src` chỉ `'self'` (font self-host). Không thêm domain ngoài khi chưa được Harold đồng ý.
- Dependency mới: ưu tiên MIT/Apache/BSD; package ngoài npm phải vendor kèm checksum (xem `vendor/`).

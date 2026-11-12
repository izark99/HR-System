# Ghi quyết định vào `docs/MEMORY.md`

- Harold chốt một quyết định (phạm vi, kiến trúc, UX, nghiệp vụ, công nghệ) → thêm ngay 1 dòng vào **đầu** nhóm tương ứng.
- Định dạng: `YYYY-MM-DD HH:MM - Quyết định` (giờ Việt Nam, lấy bằng `TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M'`). Các dòng cách nhau 1 dòng trống. Viết ngắn, rõ, không mơ hồ.
- Quyết định thay đổi → **không xóa**: thêm dòng mới ở đầu nhóm trong `docs/MEMORY.md`; chuyển dòng cũ sang đầu nhóm tương ứng của `docs/MEMORY-archive.md`, gạch `~~...~~ → thay bởi YYYY-MM-DD HH:MM`. `docs/MEMORY.md` chỉ chứa quyết định đang hiệu lực; file lưu trữ không nạp tự động, chỉ mở khi cần tra lịch sử.
- Cập nhật `docs/spec.md` cho khớp trong **cùng commit**.
- Không ghi điều Harold chưa xác nhận; ý tưởng chưa chốt đưa vào mục "Câu hỏi mở" của spec.

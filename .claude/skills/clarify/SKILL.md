---
name: clarify
description: Làm rõ và chốt yêu cầu với Harold trước khi code một tính năng của HR Data Flow Platform — soạn câu hỏi A/B/C, viết user story + acceptance criteria, ghi quyết định vào docs/MEMORY.md và cập nhật docs/spec.md. Dùng khi có yêu cầu mới, yêu cầu mơ hồ, hoặc trả lời của Harold cần ghi lại.
---

# Làm rõ & chốt yêu cầu (chạy trong session chính)

## 1. Phân tích

- Đọc `docs/MEMORY.md` và đúng các mục liên quan của `docs/spec.md` (dùng Grep tìm heading, không đọc cả file).
- Xác định: mục tiêu nghiệp vụ, vai trò (Admin/User), dữ liệu, rủi ro (dữ liệu cá nhân, hiệu năng, free tier, hạn mức).
- Kiểm tra trước những gì kiểm được (code, tài liệu nhà cung cấp, đo thật) để câu hỏi dựa trên dữ kiện, gắn nhãn [Certain]/[High confidence]/[Speculative].
- Yêu cầu mâu thuẫn MEMORY/spec → nêu mâu thuẫn ngay, hỏi Harold.

## 2. Câu hỏi

Chỉ hỏi điều ảnh hưởng thật đến thiết kế, tối đa 8 câu/vòng, sắp theo mức ảnh hưởng, đánh số nối tiếp các câu trước:

```
**N. <Câu hỏi>?**
- **A *(đề xuất)*:** <lựa chọn>. <trade-off ngắn>
- **B:** <lựa chọn>. <trade-off ngắn>
- **C:** <tùy chọn>
```

Harold trả lời dạng "1A, 2B".

## 3. Ghi quyết định

Theo `.claude/rules/decision-log.md`:
- Giờ: `TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M'`.
- Thêm dòng vào **đầu** nhóm tương ứng; quyết định thay đổi → gạch dòng cũ `~~…~~ → thay bởi …`.
- Cập nhật `docs/spec.md` cho khớp **cùng commit**; điều chưa chốt đưa vào §22 "Câu hỏi mở".

## 4. User story + acceptance criteria

- `Là <vai trò>, tôi muốn <hành động>, để <lợi ích>.`
- AC kiểm thử được (Given/When/Then hoặc bảng `AC-…`), gồm case lỗi và edge case (file sai format, thiếu cột, dữ liệu rỗng, không có version hiệu lực, biên effective date).
- Ghi vào section bước tương ứng trong spec (VD §26).

## 5. Giao việc

Khi giao `developer`/`verifier`, gửi **gói bối cảnh** ngắn: phạm vi, mục spec + AC cần đọc, dòng MEMORY liên quan, file chính, điểm rủi ro — để agent không phải đọc lại toàn bộ tài liệu.

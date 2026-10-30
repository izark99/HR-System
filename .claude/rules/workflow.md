# Đội agent & quy trình

Mô hình generator–verifier (chốt 2026-10-30): session chính làm rõ yêu cầu và điều phối; một subagent làm, một subagent kiểm.

| Thành phần | Vai trò |
|------------|---------|
| Session chính + skill `clarify` (`.claude/skills/clarify/`) | Làm rõ với Harold (câu hỏi A/B/C), user story + AC, ghi MEMORY + spec, điều phối, sửa nhỏ |
| `developer` (`.claude/agents/`) | Vòng code lớn theo spec + AC, kèm unit test |
| `verifier` (`.claude/agents/`) | Kiểm chứng độc lập: test (unit, E2E, SQL/RLS, hiệu năng) + review bảo mật/rò rỉ dữ liệu/khớp MEMORY; chỉ viết file test |

Quy trình cho mỗi tính năng:

1. **Làm rõ & chốt**: session chính theo skill `clarify`; ghi MEMORY.md + cập nhật spec.md (xem `decision-log.md`).
2. **Code**: sửa nhỏ (≲ 50 dòng, một vùng, VD test chập chờn, đổi text) session chính tự làm; vòng lớn giao `developer`.
3. **Kiểm**: `verifier`; BLOCKING/MAJOR → quay lại bước 2. Gộp các lỗi và quyết định mới vào một vòng sửa thay vì nhiều vòng nhỏ.
4. **Commit & push** khi mọi check pass.

Giao việc cho subagent luôn kèm **gói bối cảnh** ngắn (phạm vi/diff, mục spec + AC, dòng MEMORY liên quan, file chính, điểm rủi ro) để agent không phải đọc lại toàn bộ tài liệu. Session chính tự kiểm chứng thông tin quan trọng trong báo cáo của subagent trước khi chuyển cho Harold.

Giới hạn (do hạn mức gói):

- Mỗi thời điểm chỉ **1 subagent** chạy; các vòng làm **tuần tự** (xong, commit, push rồi mới giao vòng tiếp).
- Subagent phải commit + push ngay từng phần đã pass check để không mất việc nếu bị dừng giữa chừng.
- Ghi số token mỗi vòng (từ thông báo kết thúc của agent) để so sánh hiệu quả.

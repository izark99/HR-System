# Team agent & quy trình

Agent trong `.claude/agents/`:

| Agent | Vai trò |
|-------|---------|
| `requirements-analyst` | Phân tích yêu cầu, soạn câu hỏi A/B/C, user story + acceptance criteria, cập nhật spec |
| `developer` | Implement theo spec + AC, kèm unit test |
| `tester` | Viết & chạy test (unit, E2E, RLS, hiệu năng); không sửa code ứng dụng |
| `reviewer` | Review read-only: rò rỉ dữ liệu, bảo mật, tính đúng, khớp MEMORY/spec |

Quy trình cho mỗi tính năng:

1. **Làm rõ**: session chính trao đổi với Harold (dùng `requirements-analyst` khi cần). Subagent không hỏi Harold trực tiếp được.
2. **Chốt**: ghi MEMORY.md + cập nhật spec.md (xem `decision-log.md`).
3. **Code**: `developer`.
4. **Test**: `tester`; lỗi → quay lại bước 3.
5. **Review**: `reviewer`; finding BLOCKING → quay lại bước 3. Có thể chạy song song với bước 4 vì reviewer chỉ đọc.
6. **Commit & push** khi mọi check pass. Gộp các lỗi và quyết định mới vào một vòng sửa thay vì nhiều vòng nhỏ.

Giới hạn chạy song song (do hạn mức gói, chốt 2026-10-28):

- Mỗi thời điểm chỉ **1 `developer`** chạy; các vòng code làm **tuần tự** (xong, commit, push rồi mới giao vòng tiếp).
- Developer phải commit + push ngay từng phần đã pass check để không mất việc nếu bị dừng giữa chừng.

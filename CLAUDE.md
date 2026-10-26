# CLAUDE.md — HR Data Flow Platform

Webapp nội bộ xử lý dữ liệu Excel **trực tiếp trên trình duyệt** theo các flow do Admin cấu hình. Chi tiết: `spec.md`.

## Nguồn sự thật (đọc trước khi làm bất kỳ việc gì)

1. `MEMORY.md` — các quyết định đã chốt. **Quyết định trong MEMORY.md thắng mọi giả định.**
2. `spec.md` — đặc tả chi tiết.
3. Code hiện có.

Nếu yêu cầu mới mâu thuẫn với MEMORY.md hoặc spec.md → dừng lại, nêu rõ mâu thuẫn và hỏi Harold, không tự quyết.

@MEMORY.md

## Quy tắc cập nhật MEMORY.md (bắt buộc)

- Mỗi khi Harold chốt một quyết định (phạm vi, kiến trúc, UX, quy tắc nghiệp vụ, công nghệ) → thêm ngay 1 dòng vào đúng nhóm: `YYYYMMDD - Quyết định` (ngày thực tế, viết ngắn, rõ, không mơ hồ).
- Khi quyết định thay đổi → **không xóa**; gạch dòng cũ `~~...~~ → thay bởi YYYYMMDD` và thêm dòng mới.
- Cập nhật `spec.md` cho khớp trong cùng commit.
- Không ghi vào MEMORY.md những điều chưa được Harold xác nhận.

## Cách giao tiếp với Harold

- Tiếng Việt; mix thuật ngữ tiếng Anh khi tự nhiên hơn. Tài liệu: formal. Trao đổi: casual.
- Đi thẳng vào vấn đề, kết luận/đề xuất trước, giải thích sau.
- Khi cần làm rõ: **mỗi câu hỏi luôn kèm 2–3 lựa chọn (A/B/C)**, đánh dấu lựa chọn đề xuất và trade-off ngắn. Harold trả lời dạng "1A, 2B".
- Vấn đề có rủi ro (dữ liệu, bảo mật, chi phí) → đưa đủ thông tin để Harold tự quyết.
- Harold sai hoặc thiếu sót → nói thẳng, constructive.

## Team agent (`.claude/agents/`)

| Agent | Vai trò | Khi nào dùng |
|-------|---------|--------------|
| `requirements-analyst` | Phân tích yêu cầu, soạn câu hỏi A/B/C, viết user story + acceptance criteria, cập nhật spec.md | Có yêu cầu mới / mơ hồ, trước khi code |
| `developer` | Implement theo spec + acceptance criteria | Sau khi yêu cầu đã chốt |
| `tester` | Viết & chạy test (unit, integration, RLS, E2E), báo lỗi | Sau mỗi thay đổi của developer |
| `reviewer` | Review code, bảo mật, tuân thủ nguyên tắc dữ liệu (read-only) | Trước khi commit/push |

### Quy trình chuẩn cho mỗi tính năng

1. **Làm rõ**: session chính (trao đổi trực tiếp với Harold) dùng `requirements-analyst` để soạn câu hỏi + user story. Subagent không hỏi Harold trực tiếp được — session chính chuyển câu hỏi và câu trả lời.
2. **Chốt**: ghi quyết định vào MEMORY.md, cập nhật spec.md.
3. **Code**: `developer` implement, kèm unit test cơ bản.
4. **Test**: `tester` viết test theo acceptance criteria, chạy toàn bộ; lỗi → quay lại bước 3.
5. **Review**: `reviewer` kiểm tra; finding mức blocking → quay lại bước 3.
6. **Commit & push** khi lint, typecheck, test đều pass. Báo Harold kết quả thật (kể cả test fail).

## Nguyên tắc kỹ thuật bất di bất dịch

- **Không nhắc tên công ty của Harold** ở bất kỳ đâu trong dự án (code, tài liệu, dữ liệu mẫu, commit message, comment). Dùng cách gọi chung: "công ty", "tổ chức". Mã NV mẫu dùng tiền tố `NV`.
- **Không bao giờ gửi nội dung file Excel/dữ liệu nhân sự lên server** (không upload, không log, không gửi telemetry). Mọi xử lý trong Web Worker.
- Bảng tham chiếu trên server chỉ chứa dữ liệu không mang tính cá nhân.
- Run log chỉ chứa metadata; tên file gốc lưu dạng hash.
- Mọi bảng Supabase bật RLS; client không bao giờ dùng service role key.
- Tham số User nhập chỉ được bind dưới dạng giá trị (prepared statement / dict), không nối chuỗi vào SQL/Python.
- CSP `connect-src` chỉ cho phép domain app + Supabase.
- Tiền lương dùng decimal, không dùng float.
- Dữ liệu test luôn là dữ liệu giả, không dùng dữ liệu thật của công ty.

## Stack & quy ước code

- TypeScript strict, React 19, Vite, Tailwind v4, shadcn/ui, TanStack Router/Query, Zod, @xyflow/react, DuckDB-WASM, Pyodide, SheetJS (đọc), ExcelJS (ghi), i18next, Supabase.
- pnpm workspace. Cấu trúc thư mục theo `spec.md` §19.
- Mỗi node type là 1 plugin trong `apps/web/src/engine/nodes/` (Zod schema + form + compile/execute + suy diễn schema output).
- Text UI luôn qua i18next (`vi` mặc định), không hard-code chuỗi tiếng Việt trong component.
- Tên biến/hàm bằng tiếng Anh; comment ngắn, chỉ khi cần giải thích "tại sao".

## Lệnh thường dùng

> Cập nhật khi đã scaffold dự án.

```bash
pnpm install
pnpm dev          # chạy app
pnpm lint
pnpm typecheck
pnpm test         # Vitest
pnpm test:e2e     # Playwright
supabase start    # Supabase local
supabase test db  # test RLS (pgTAP)
```

## Git

- Không commit secrets (`.env*`, service key). Chỉ commit `.env.example`.
- Commit message rõ ràng; mỗi commit làm một việc.

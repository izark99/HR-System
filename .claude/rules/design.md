---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.css"
  - "apps/web/index.html"
  - "apps/web/public/**"
---

# Design & Frontend

- Theo design system `docs/spec.md` §25 ("bright executive" bản 2, phong cách phẳng). Token màu, chữ, bo góc, khoảng cách, shadow khai báo một chỗ trong `@theme` của `index.css`; không dùng giá trị ngoài token.
- Giữ nguyên bộ màu §25.2. Chữ trắng chỉ đặt trên `#0F766E`, `#1F2A44`, `#1D4ED8`. `#14B8A6` chỉ để trang trí.
- Bo góc: 6px input, 12px card/nút/popover/dialog/node, 999px pill. Không bo 16–24px.
- Card: viền 1px `#E2E8F0`, **không shadow**. Shadow chỉ cho lớp nổi (popover, dialog, toast).
- Nút 3 cấp cao 44px (nút nhỏ 36px), input/Select/picker 44px, dòng bảng Admin 48px: chính teal (mỗi vùng 1 nút), tối `#1F2A44`, outline viền `#1F2A44`; thêm nút chữ và nút nguy hiểm. Không làm nút dạng pill.
- Eyebrow: chữ in hoa, giãn chữ 1px, không nền. Tiêu đề viết hoa đầu câu; độ đậm theo token §25.1 (`page-title`/`page-title-showcase`/`kpi` 600, `title-md` 600, `title-sm` 700, eyebrow 500).
- Thang chữ §25.1 (body 16px, tiêu đề trang workspace 28px / showcase 32px, KPI 40px, mobile thu nhỏ; không dùng thang tiêu đề lớn của `docs/design-reference.md`; canvas Designer, Monaco, bảng xem trước dữ liệu giữ 14px); một font Be Vietnam Pro self-host, không thêm request tới domain ngoài.
- Mọi text UI qua i18next (`vi` mặc định); không hard-code chuỗi tiếng Việt trong component.
- A11y: dùng `<button>`, `<label>`, `<a href>` thật; touch target ≥ 44px; tương phản chữ WCAG AA, viền control ≥ 3:1; tab theo pattern APG. Không dùng `<select>` và date picker mặc định.
- Thư viện nặng (bảng, chart, Monaco) lazy-load theo route; SheetJS/ExcelJS/engine chỉ nằm trong chunk worker.
- Khung & pattern theo §25.5: màn mới dùng `PageShell` + một mẫu màn (List, Form, Wizard, Report); không tự viết `<main>`, tabs, bảng Admin, ô nhập có nhãn, toast, icon SVG trong file màn — dùng component trong `components/` (`Tabs`, `DataTable`, `FormField`, `EmptyState`, `useToast`, `Dialog`/`ConfirmDialog`, `icons/`). Cần pattern mới → thêm vào `components/` + spec §25.5 trước.
- Khoảng cách chỉ theo thang `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64` px (Tailwind `1 · 2 · 3 · 4 · 6 · 8 · 12 · 16`); mọi màn có đủ trạng thái đang tải / rỗng / lỗi / thành công (§25.5).
- **Bố cục không lệch** (AC-UI-78): control cùng hàng cùng chiều cao và thẳng mép; không tràn khỏi card/panel, không chồng lấn; khoảng cách cùng hàng đều nhau; tab cùng kích thước; nhãn/gợi ý dài không đẩy lệch control. Bộ `e2e/layout-lint` phải pass ở 1280, 1024 và 390px; mọi màn/form mới phải được thêm vào bộ này. Trước khi gửi ảnh cho Harold, tự soi từng ảnh.

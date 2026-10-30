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
- Nút 3 cấp cao 48px: chính teal (mỗi vùng 1 nút), tối `#1F2A44`, outline viền `#1F2A44`; thêm nút chữ và nút nguy hiểm. Không làm nút dạng pill.
- Eyebrow: chữ in hoa, giãn chữ 1px, không nền. Tiêu đề viết hoa đầu câu, weight 600.
- Thang chữ §25.1 (body 16px, tiêu đề trang 48px, mobile thu nhỏ); một font Be Vietnam Pro self-host, không thêm request tới domain ngoài.
- Mọi text UI qua i18next (`vi` mặc định); không hard-code chuỗi tiếng Việt trong component.
- A11y: dùng `<button>`, `<label>`, `<a href>` thật; touch target ≥ 44px; tương phản chữ WCAG AA, viền control ≥ 3:1; tab theo pattern APG. Không dùng `<select>` và date picker mặc định.
- Thư viện nặng (bảng, chart, Monaco) lazy-load theo route; SheetJS/ExcelJS/engine chỉ nằm trong chunk worker.

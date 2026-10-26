---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.css"
  - "apps/web/index.html"
  - "apps/web/public/**"
---

# Frontend

- Theo design system `docs/spec.md` §25 ("bright executive"). Token màu/chữ khai báo một chỗ trong `@theme` của `index.css`; không dùng màu ngoài token.
- Chữ trắng chỉ đặt trên `#0F766E`, `#1F2A44`, `#1D4ED8`. `#14B8A6` chỉ để trang trí.
- Mọi text UI qua i18next (`vi` mặc định); không hard-code chuỗi tiếng Việt trong component.
- A11y: dùng `<button>`, `<label>`, `<a href>` thật; touch target ≥ 44px; tương phản WCAG AA; tab theo pattern APG.
- Font Be Vietnam Pro self-host; không thêm request tới domain ngoài.
- Thư viện nặng (bảng, chart) lazy-load theo route; SheetJS/ExcelJS/engine chỉ nằm trong chunk worker.
- Wireframe tham chiếu: https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW

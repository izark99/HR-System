---
paths:
  - "apps/web/src/engine/**"
  - "packages/flow-schema/**"
---

# Engine & flow schema

- Mỗi node type là 1 plugin trong `apps/web/src/engine/nodes/`: Zod config schema (ở `packages/flow-schema`), ports, `inferSchema`, `execute` (sau này `compile` sang SQL DuckDB). Thêm node không sửa core executor.
- Engine là TypeScript thuần, không import React, chạy được trong Node để test (Vitest).
- Main thread không parse Excel; mọi xử lý qua worker (`engine/worker.ts`, `session.ts`, giao thức ở `protocol.ts`).
- Tiền, ngày công: dùng decimal (big.js), không float. Decimal sang UI dưới dạng string.
- Thông báo lỗi/validation là i18n key + params (`locales/vi/engine.json`), không hard-code text tiếng Việt.
- Lỗi phải chỉ rõ node / file / dòng Excel gốc / cột.
- Không giả định định dạng dữ liệu nghiệp vụ trong code (VD định dạng Mã NV): đó là cấu hình của Admin trong flow/input slot.
- Không dùng `arr.push(...bigArray)` hoặc spread mảng lớn vào lời gọi hàm (tràn stack khi >100k dòng).

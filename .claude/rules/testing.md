---
paths:
  - "**/__tests__/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "e2e/**"
  - "fixtures/**"
---

# Testing

- Chỉ dùng **dữ liệu giả** (Faker hoặc `fixtures/`, sinh bằng script có seed cố định). Không dùng dữ liệu thật.
- Test flow nghiệm thu phải khớp `fixtures/payroll-timesheet/expected.json`.
- Không skip/disable test để cho pass. Bug đã biết: đánh dấu `it.fails` / `test.fail` trong nhóm "KNOWN BUG", gỡ khi đã sửa.
- Test nặng (dữ liệu lớn, hiệu năng) phải opt-in qua biến môi trường (`HRFLOW_PERF=1`, `HEAVY_E2E=1`) để CI nhanh.
- E2E dùng Chromium cài sẵn (`/opt/pw-browsers/chromium`), không chạy `playwright install`. E2E phải khẳng định không có request ra ngoài origin và storage trống sau khi chạy.
- File output của test ghi vào thư mục temp của OS, không commit.

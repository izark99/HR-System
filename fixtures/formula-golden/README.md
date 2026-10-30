# Golden test cho node `transform.formula`

Dữ liệu giả, sinh bằng `python3 fixtures/formula-golden/generate.py` (cần `openpyxl`).

- `golden.xlsx`: sheet `cases`, mỗi dòng 1 case. Cột C là công thức theo cú pháp của hệ thống
  (`[a]`, `[b]`, `[c]`), cột D–F là ô đầu vào, cột G là **công thức Excel thật** (chưa có giá trị),
  cột H là loại lỗi (`ERROR.TYPE`), cột I là ghi chú.
- `cases.json`: cùng danh sách case kèm kiểu đầu vào và kết quả mong đợi của engine; các khác biệt
  có chủ đích với Excel ghi ở trường `excel` + `note`, hành vi Excel cần xác nhận ghi ở `confirm`.

## Việc Harold cần làm (1 lần)

1. Mở `golden.xlsx` bằng **Excel desktop** (Windows hoặc Mac, không dùng Excel Online/Google Sheets).
2. Bấm **Enable Editing** nếu Excel hỏi.
3. Nhấn **Ctrl+Alt+F9** (Mac: Cmd+Option+F9 hoặc Formulas → Calculate Now) để tính lại toàn bộ.
4. **File → Save As**, giữ định dạng `.xlsx`, đặt tên **`golden-excel.xlsx`** trong cùng thư mục này.
5. Gửi lại file `golden-excel.xlsx` (không cần sửa gì khác).

Khi chưa có `golden-excel.xlsx`, test so với Excel được bỏ qua kèm lý do; các case vẫn được kiểm
với kết quả mong đợi trong `cases.json`.

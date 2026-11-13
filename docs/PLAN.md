# PLAN — Lộ trình và nguyên tắc điều hành

> Lập: 2026-11-12, bởi session project owner (Harold giao, MEMORY 2026-11-12 21:09). Người thực hiện: session Opus + subagent `developer` / `verifier`.
> Thứ tự đọc mỗi session: `CLAUDE.md` → `docs/MEMORY.md` → **file này** → `docs/HANDOFF.md`.
> Thứ tự ưu tiên khi mâu thuẫn: MEMORY > PLAN > spec > HANDOFF. Harold đã duyệt lộ trình này và chốt D-1, D-2, D-3 ngày 2026-11-12 21:14 (§9). Về sau, mục nào đổi một quyết định đã chốt phải đánh dấu **⏳ D-n** và chỉ có hiệu lực sau khi Harold trả lời và được ghi vào MEMORY.
> Cập nhật file này khi một mốc đổi trạng thái (cùng commit với HANDOFF). Không chép lại nội dung spec vào đây.

## 1. Đích đến

Dự án là **thử nghiệm cá nhân** của Harold. Thành công là Harold dùng app cho việc Excel lặp lại thật của mình, không phải số tính năng hay độ hoàn hảo của giao diện.

| # | Thước đo | Cách đo | Hiện tại (2026-11-12) |
|---|----------|---------|------------------------|
| T1 | ≥ 3 flow published khác loại (đối chiếu; gộp + làm sạch; tổng hợp báo cáo), mỗi flow có fixture giả + kết quả kỳ vọng | `flow_versions`, `fixtures/` | 1 flow |
| T2 | Harold tự dựng một flow mới 5–8 node trong Designer ≤ 30 phút, không sửa JSON, không cần Claude | Harold bấm giờ ở M2 và sau M3 | chưa đo |
| T3 | ≥ 10 lần chạy thật trong 30 ngày liên tiếp | `run_logs` | 3 lần chạy / 17 ngày, 1 tài khoản |
| T4 | 0 kết quả sai đã biết; RLS đã kiểm trên DB thật; có bản sao lưu đã khôi phục thử | HANDOFF §3 | RLS chưa kiểm trên DB thật, chưa có sao lưu |
| T5 | Mỗi vòng đổi UI cần ≤ 1 vòng sửa sau khi Harold xem | HANDOFF §6 | vòng B cần 4 vòng sửa |

## 2. Hiện trạng đã kiểm (2026-11-12)

- Nhánh hiện tại: lint, typecheck, unit test (1.348 pass, 4 expected-fail, 12 skip), build đều pass. JS tải ban đầu 214,7 / 240 KiB (còn 25,3 KiB, ngưỡng mới từ 2026-11-12).
- Production: 2 tài khoản, 0 nhóm, 1 version published, 3 lần chạy, 1 bảng tham chiếu, 104 dòng text Harold đã sửa ở tab "Văn bản giao diện".
- Khoảng 60% token subagent đã ghi (4,2M / 6,8M, HANDOFF §6) dùng cho các vòng giao diện.
- Bảng tham chiếu vòng 1 đã lên `main` nhưng chưa flow nào đọc được bảng (thiếu vòng 2).
- Repo GitHub đang **public**.
- Chưa có: màn Logs, nhân bản flow, tạo input slot từ file mẫu, panel Designer thu gọn/đổi kích thước. Sao lưu và kiểm RLS trên DB thật đã có workflow (2026-11-12), chờ secret để chạy lần đầu.

## 3. Nguyên tắc điều hành

1. **Mọi việc phải truy được** về một mốc ở §4 hoặc một dòng trong nhật ký vướng mắc §7. Không truy được thì không làm; ghi vào §6.
2. **Một mốc mỗi lúc.** Mốc chỉ đóng khi đạt đủ "Xong khi" của nó và §5.
3. Thứ tự giá trị: **đúng dữ liệu > Harold làm được việc > nhanh > đẹp.**
4. **Thời gian của Harold là tài nguyên hiếm nhất.** Tối đa 3 câu hỏi mỗi vòng, dạng A/B/C có đề xuất. Việc Harold phải làm tay (dán SQL, thêm secret, đo máy thật) gom một lần mỗi mốc, kèm hướng dẫn từng bước.
5. **Dừng và hỏi Harold** khi: trái MEMORY; vượt ngân sách bundle; cần đổi CSP hoặc thêm dependency; SQL có `drop`/`delete` trên DB thật; cần hơn 1 vòng sửa cho cùng một việc; một vòng `developer` dự kiến > 400k token (chia nhỏ trước).
6. **Không đánh bóng.** Không đổi token, khung, thang chữ, bộ màu; không thêm luật `layout-lint`; không thêm animation, dark mode — trừ khi là mục của mốc đang mở.
7. Bài học đã gặp nằm ở `.claude/rules/pitfalls.md` (luôn được nạp). Gặp lỗi quy trình mới: thêm 1 dòng vào đó trong cùng commit sửa lỗi.

## 4. Lộ trình

Thứ tự: M0 → M1 → M2 → M3 → M4 → M5. Harold có thể bắt đầu phần của mình ở M2 bất cứ lúc nào, không cần chờ.

### M0 — Nền vững (session chính tự làm, không cần `developer`)

| # | Việc | Xong khi |
|---|------|----------|
| 0.1 | Kiểm RLS trên DB thật. Đã có (2026-11-12): workflow chạy tay `.github/workflows/db-tests.yml` + `scripts/db-tests.sh` chạy cả 5 file `supabase/tests/*.sql` trên DB thật (mỗi file tự rollback; đã chạy thử trên Postgres local: 5/5 OK). Còn lại: Harold thêm secret `SUPABASE_DB_URL` (README "Sao lưu và khôi phục"), rồi chạy workflow (Opus gọi được bằng công cụ GitHub, đọc log) | Một lần chạy xanh trên DB thật, 5 dòng `db-tests: OK`; ghi vào HANDOFF §3. Có dòng FAIL → sửa trước mọi việc khác |
| 0.2 | Sao lưu hằng tuần. Đã có (2026-11-12): `.github/workflows/backup.yml` + `scripts/backup/dump-and-verify.sh`: `pg_dump` dữ liệu schema `public` qua session pooler, **khôi phục thử** vào database tạm dựng từ `supabase/migrations/` và so số dòng từng bảng, mã hóa GPG AES-256, artifact 90 ngày (đã diễn tập trên Postgres local: đạt; database tạm không trống và cột lệch migrations đều bị bắt). Không gồm schema `auth`. Còn lại: Harold thêm 2 secret, chạy tay lần đầu | Một lần chạy xanh trên GitHub (đã gồm khôi phục thử). Lần chạy đỏ vì lệch cột/bảng nghĩa là DB thật khác `supabase/migrations/` → điều tra ngay |
| 0.3 | ✅ Ngân sách JS (D-1A, xong 2026-11-12): ngưỡng tuyệt đối 240 KiB + kiểm tra thư viện nặng không vào JS tải ban đầu | Đã xong: `bundle-budget.json`, `check-bundle-size.mjs`, spec §18, MEMORY khớp nhau |
| 0.4 | ✅ Thuật ngữ (xong 2026-11-13): 104 dòng Harold sửa trên production thành chữ mặc định của `locales/vi/common.json`; bảng thuật ngữ ở spec §25.4; tên app "HR Tools" cả ở `index.html` và manifest; 133 dòng E2E bám chữ cũ đã sửa; 52 ảnh gốc chụp lại và soi; tên đọc của link trang chủ ghép từ 2 key (`app.name` + `app.home`) để sửa chữ không làm hỏng WCAG 2.5.3 | Đã xong. Còn 2 điểm hiển thị chờ Harold (§7) |
| 0.5 | ✅ Tài liệu khớp code (xong 2026-11-12): bảng trạng thái README, mục "Sao lưu và khôi phục", spec §5 đánh dấu thư viện không dùng, dòng phiên bản đầu spec | Đã xong |
| 0.6 | Harold chạy `pnpm perf:local` trên laptop thật | Có số cho AC-B3-24, ghi HANDOFF §4.5 |
| 0.7 | ✅ Lưu trữ quyết định đã bị thay (D-3A, xong 2026-11-12): 34 dòng chuyển sang `docs/MEMORY-archive.md` | Đã xong: `MEMORY.md` chỉ còn quyết định đang hiệu lực; `decision-log.md` khớp |

### M1 — Bảng tham chiếu vòng 2 (hoàn tất khoản đã đầu tư)

Phạm vi đã chốt: spec §34 AC-RT-07, 08, 10 và phần `flow_versions.ref_tables` của AC-RT-09; mẫu đã duyệt https://claude.ai/artifact/92KZJ49WJTdFoxWMo26kar. Không làm rõ lại. Chia 2 vòng `developer`, mỗi vòng có `verifier`:

- **2a — dữ liệu và engine:** migration (`flow_versions.ref_tables` do trigger tính, quyền User đọc version published của bảng thuộc flow được gán), test RLS, node `input.refTable`, chọn version theo as-of date, run log ghi `ref_versions`, xử lý giá trị không khớp kiểu sau khi đổi kiểu cột (HANDOFF §4.17d). `verifier` thử vượt RLS ngay vòng này.
- **2b — giao diện:** form node trong Designer, tham số `fromRefTable`, màn Chạy flow, xem trước trong Designer.

Xong khi: một flow thật dùng bảng tham chiếu chạy đúng với kỳ hiện tại và kỳ cũ; test RLS của phần User pass trên **DB thật**; đã đo lưu 5 MB qua PostgREST trên Supabase thật (HANDOFF §4.17b); flow nghiệm thu không đổi kết quả.

### M2 — Dùng thật: 2 flow mới do Harold dựng

- Harold chọn 2 việc Excel lặp lại thật (gợi ý: gộp + làm sạch file các chi nhánh; tổng hợp headcount/biến động theo tháng) và tự dựng bằng Designer, bấm giờ.
- Harold báo vướng mắc bằng lời hoặc ảnh **không chứa dữ liệu thật**; mô tả cấu trúc cột, không dán nội dung file vào chat.
- Opus: ghi từng vướng mắc vào §7; sửa ngay lỗi chặn (bug); phần "chậm/khó chịu" để dành cho M3; sinh fixture giả cùng cấu trúc + kết quả kỳ vọng cho từng flow.
- Opus không tự dựng flow thay Harold: mục đích là đo T2.

Xong khi: 2 flow published, mỗi flow chạy thật ≥ 1 lần và có test; §7 có bảng vướng mắc đã xếp hạng (số lần gặp × thời gian mất).

### M3 — Designer thuận tiện

Tối đa 2 vòng `developer` (3a rồi 3b), chọn theo xếp hạng ở §7. Ứng viên đã kiểm bằng ảnh và code ngày 2026-11-12:

- **3a — chỗ làm việc:** palette và panel cấu hình thu gọn được, panel dữ liệu kéo đổi chiều cao (trạng thái chỉ giữ trong bộ nhớ của tab, không ghi storage); ở 1280×800 canvas ≥ 60% bề ngang khi thu gọn; chữ trong node đọc được ở khung nhìn mặc định (≥ 12px thực tế, flow lớn thì kéo thay vì thu nhỏ); cổng node hiện nhãn tiếng Việt thay cho `left`, `only_left`, `summary`; ô chọn file mẫu dùng control của app (hiện đang là ô mặc định của trình duyệt, chữ tiếng Anh); bảng xem trước có tiêu đề dính.
- **3b — ít bước hơn:** thêm node khi đang chọn một node thì tự nối vào cổng ra còn trống; kéo từ cổng ra vùng trống mở danh sách node nối được; "Tạo input slot từ file mẫu" (dò dòng tiêu đề, tên cột, kiểu — đọc trong worker, chỉ trong RAM); "Nhân bản flow" thành flow mới ở trạng thái draft.

Xong khi: T2 đạt khi Harold dựng lại một flow tương đương M2; `layout-lint` và so ảnh pass; T5 đạt.

### M4 — Phần còn thiếu của Admin và User

Bắt buộc: màn **Lịch sử hoạt động** (run log toàn hệ thống + audit log; lọc theo flow, người, trạng thái, khoảng ngày; không có nội dung dữ liệu) thay cho mục menu đang "Sắp ra mắt".
Theo §7, chỉ làm nếu Harold thật sự vướng: màn Kết quả cho flow không có `control.compare` (hiện chỉ có tiêu đề "Hoàn thành"); diff version đọc theo nhãn field, JSON chuyển thành lối xem nâng cao; lưới dữ liệu bảng tham chiếu dày hơn và cuộn ảo thay cho "Hiện thêm 100 dòng".

### M5 — `output.template`

Giữ thứ tự Phase 2 đã chốt (MEMORY 2026-11-04 15:34). Điều kiện mở: Harold chỉ ra một mẫu báo cáo thật cần đổ dữ liệu. Bắt đầu bằng skill `clarify`.

### Có điều kiện

- `code.python` (Pyodide) — D-2A, chốt 2026-11-12: chỉ mở khi có một flow thật không viết được bằng `code.sql` + `transform.formula`.
- `output.chart`, các node Phase 2 khác, tiếng Anh: chưa xếp, xem §6.

## 5. Chuẩn làm việc cho mọi vòng

**Trước khi giao `developer`:** AC đo được (số px, hành vi, thông báo), không có AC kiểu "đẹp hơn", "gọn hơn"; gói bối cảnh theo `.claude/rules/workflow.md`; ước lượng token, > 400k thì chia.

**Với thay đổi UI** (bắt buộc, theo thứ tự):

1. Dựng mẫu Artifact tương tác, tự kiểm không tràn/chồng lấn ở 1280 và 1024 (thêm 390 cho màn User), Harold duyệt.
2. `developer` code theo mẫu đã duyệt.
3. Session chính tự soi **từng ảnh** trước khi gửi Harold; Harold chỉ nhận một lần ảnh trước/sau.
4. Mỗi màn mới thêm tối đa 2 ảnh gốc; ảnh gốc cập nhật trong cùng commit đổi UI.

**Hướng UX** (áp cho mọi màn mới hoặc sửa):

- Nội dung làm việc chiếm chỗ: canvas, bảng dữ liệu là chính; panel phụ thu gọn được.
- Ít bước hơn cho việc lặp lại: mẫu, nhân bản, tự nối, tự dò từ file mẫu.
- Phản hồi tại chỗ: lỗi ngay tại field, số dòng ngay trên node; không bắt mở chỗ khác để hiểu.
- Một từ cho một khái niệm, theo bảng thuật ngữ spec §25.4.
- Mật độ theo ngữ cảnh: màn đọc và quyết định (User) giữ thang chữ lớn; Designer và lưới dữ liệu dùng mật độ cao (ngoại lệ dense đã có).
- Thao tác chính của Designer có phím tắt, hiện trong tooltip.
- Không lộ kỹ thuật ở đường chính: không key nội bộ, không JSON thô.

**Xong một vòng khi:** lint, format:check, typecheck, test, build pass; đụng UI/worker thì full E2E trên bản build mới; `verifier` PASS; MEMORY/spec/HANDOFF/PLAN cập nhật cùng commit; báo cáo cho Harold gồm: đã làm gì, bằng chứng (lệnh + kết quả), chưa làm gì, câu hỏi A/B/C, token đã dùng, ngân sách JS còn lại.

## 6. Không làm (cho tới khi Harold yêu cầu)

Dark mode, animation mới, đổi bộ màu/font/thang chữ, command palette, thêm luật `layout-lint`, tối ưu thêm hiệu năng đọc .xlsx, tiếng Anh, Admin dashboard thống kê, SSO/2FA, E2E trong CI GitHub, `subflow`, `control.branch`.

## 7. Nhật ký vướng mắc

Mỗi dòng một vướng mắc thật khi dùng app. Mức: chặn / chậm / khó chịu.

| Ngày | Màn | Đang làm gì | Vướng gì | Mức | Mốc xử lý |
|------|-----|-------------|----------|-----|-----------|
| 2026-11-12 | Designer | Xem flow 5 node ở 1280×800 | Chữ trong node quá nhỏ; mở panel dữ liệu thì canvas chỉ còn một dải thấp (nguồn: review ảnh, chưa phải Harold báo) | chậm | M3a |
| 2026-11-13 | Menu Admin | Đọc menu trái | Chữ mới "Sắp ra mắt" dài hơn "Sắp có" nên "Tổng quan" và "Lịch sử hoạt động" bị cắt "…" (đang có trên production vì là chữ Harold sửa). Chờ Harold chọn: chip ngắn lại / menu rộng hơn / bỏ mục chưa có | khó chịu | chờ Harold |
| 2026-11-13 | Chạy flow (390px) | Bấm nút chính trên điện thoại | "Bắt đầu (sửa 1 lỗi trước)" dài hơn nên thanh nút dính đáy xuống 2 dòng, che nhiều màn hình hơn. Câu "Phiên làm việc sẽ tự kết thúc 04:59" thiếu chữ "sau" (Harold bỏ khi sửa chữ) | khó chịu | chờ Harold |
| 2026-11-12 | Admin | Muốn xem ai chạy gì | Không có màn Logs (nguồn: review) | chậm | M4 |

## 8. Việc Harold làm tay

1. ~~Trả lời §9~~ (xong 2026-11-12).
2. M0.1 + M0.2: thêm 2 secret `SUPABASE_DB_URL` và `BACKUP_PASSPHRASE` trên GitHub (hướng dẫn từng bước: README, mục "Sao lưu và khôi phục"), rồi báo lại. Sau đó Opus chạy hai workflow "Database tests on Supabase" và "Supabase backup" và đọc kết quả; Harold không phải dán SQL.
3. M0.6: chạy `pnpm perf:local` trên laptop, gửi số.
4. M2: chọn và dựng 2 flow thật, báo vướng mắc.
5. Nên làm: chuyển repo GitHub sang **private** (Settings → General → Danger Zone). Repo đang public và chứa ghi chú vận hành (mã project Supabase, tên tài khoản Admin đầu tiên, các điểm chưa kiểm). Cloudflare Pages và GitHub Actions vẫn chạy với repo private.
6. Sau khi chữ mặc định mới (M0.4) lên `main`: vào tab "Cài đặt UI" bấm "Khôi phục tất cả" để 104 dòng đã sửa trở về mặc định (nay mặc định chính là chữ đã sửa), danh sách "đã sửa" sạch lại.

## 9. Quyết định của Harold về kế hoạch này

Đã chốt 2026-11-12 21:14 (ghi trong MEMORY):

- **D-1A** — ngân sách JS tải ban đầu: ngưỡng tuyệt đối 240 KiB gzip, kèm kiểm tra Monaco, React Flow, DuckDB, SheetJS, ExcelJS không nằm trong JS tải ban đầu.
- **D-2A** — `code.python` chỉ mở khi có flow thật không viết được bằng SQL + công thức.
- **D-3A** — quyết định đã bị thay chuyển sang `docs/MEMORY-archive.md`.

Đang chờ: chưa có.

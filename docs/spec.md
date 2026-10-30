# HR Data Flow Platform — Đặc tả hệ thống (spec.md)

> Phiên bản: 0.2 (draft) · Ngày: 2026-10-26 · Chủ sở hữu: Harold (HR Analytics)
> Trạng thái: Chờ review · 0.2: bổ sung phạm vi Bước 3 (Flow Designer, DuckDB-WASM, nhóm transform cơ bản, Version & diff, tự đăng xuất) theo quyết định 2026-10-26 22:52; cập nhật theo quyết định 2026-10-27 07:31 (Q8–Q15)

---

## 1. Tổng quan

Webapp nội bộ cho phép **xử lý dữ liệu Excel trực tiếp trên trình duyệt** theo các **flow** do Admin cấu hình. User chỉ cần chọn flow, upload file, nhập tham số, chạy và tải kết quả.

Hệ thống được thiết kế như một **framework**: logic nghiệp vụ không nằm trong code mà nằm trong **cấu hình flow (JSON)**. Admin tự xây flow mới cho từng nhu cầu (đối chiếu lương – chấm công, gộp file chi nhánh, báo cáo headcount/turnover…) mà không cần sửa code.

### 1.1 Mục tiêu

| # | Mục tiêu | Đo lường |
|---|----------|----------|
| G1 | Dữ liệu nhân sự **không rời máy user** | 0 byte nội dung file upload lên server |
| G2 | Admin tự cấu hình flow, không cần dev | Flow mới được tạo hoàn toàn qua UI |
| G3 | Linh hoạt tối đa trong xử lý | Hỗ trợ đồng thời **hàm Excel, SQL, Python** |
| G4 | Chi phí vận hành = 0 | Chạy trên free tier (Cloudflare Pages + Supabase Free) |
| G5 | Kết quả đúng mẫu báo cáo | Xuất Excel theo template do Admin upload |

### 1.2 Ngoài phạm vi (Non-goals)

- Không lưu trữ dữ liệu nhân sự (dữ liệu cá nhân) trên server.
- Không thay thế HRIS / phần mềm lương.
- Không chạy flow theo lịch (scheduled) phía server — mọi xử lý đều do user kích hoạt trên trình duyệt.
- Không hỗ trợ mobile cho phần Admin (Flow Designer). Phần User chạy flow chỉ cần dùng tốt trên desktop/laptop.
- Không có 2FA, không có SSO (MVP).

---

## 2. Nguyên tắc thiết kế

1. **Local-first data processing**: mọi file Excel được đọc, xử lý và xuất ngay trong trình duyệt (Web Worker + WebAssembly).
2. **Server chỉ giữ metadata**: tài khoản, cấu hình flow, template, bảng tham chiếu *không chứa dữ liệu cá nhân*, nhật ký chạy (không chứa nội dung).
3. **Configuration as data**: flow là một tài liệu JSON có schema, được validate, versioning và có hiệu lực theo ngày (effective date).
4. **Một engine, ba ngôn ngữ**: dữ liệu nội bộ luôn là bảng (Apache Arrow / DuckDB table); hàm Excel, SQL và Python đều đọc/ghi trên cùng định dạng này.
5. **Fail early, explain clearly**: validate input trước khi chạy; lỗi phải chỉ rõ node, dòng, cột và lý do bằng tiếng Việt.
6. **Least privilege**: phân quyền bằng Row Level Security (RLS) của Postgres; client không bao giờ giữ service key.

---

## 3. Vai trò & quyền

| Quyền | Admin | User |
|-------|:-----:|:----:|
| Quản lý tài khoản (tạo, khóa, reset mật khẩu) | ✅ | ❌ |
| Quản lý nhóm (group) & gán flow | ✅ | ❌ |
| Thiết kế flow, viết Excel/SQL/Python | ✅ | ❌ |
| Publish flow, quản lý effective date | ✅ | ❌ |
| Quản lý bảng tham chiếu & template | ✅ | ❌ |
| Xem audit log / run log toàn hệ thống | ✅ | ❌ |
| Chạy flow được gán (bản Published) | ✅ | ✅ |
| Xem lịch sử chạy của chính mình | ✅ | ✅ |
| Đổi mật khẩu của chính mình | ✅ | ✅ |

- User **chỉ chạy**, không được chỉnh hay clone flow.
- Code (SQL/Python) chỉ do Admin viết; User không thể đưa code vào hệ thống (tham số runtime được truyền dưới dạng **giá trị**, không bao giờ nối chuỗi vào code — xem §9.5).
- Flow được gán cho **user** hoặc **group**. User thấy flow nếu được gán trực tiếp hoặc qua group.

---

## 4. Kiến trúc tổng thể

```
┌──────────────────────────── Trình duyệt (máy user) ────────────────────────────┐
│                                                                                 │
│  React SPA (UI)                                                                 │
│   ├─ Admin: Flow Designer (canvas), Users, Groups, Ref tables, Templates, Logs  │
│   └─ User : Run Wizard, Run history                                             │
│        │  postMessage (Comlink) — Arrow IPC buffers                             │
│        ▼                                                                        │
│  Engine Worker (Web Worker)                                                     │
│   ├─ Excel reader (SheetJS) ──► Arrow table                                     │
│   ├─ DuckDB-WASM  (SQL + Excel formula đã transpile)                            │
│   ├─ Python Worker riêng: Pyodide + pandas (lazy load)                          │
│   └─ Excel writer (ExcelJS: multi-sheet + template fill)                        │
│                                                                                 │
│  File Excel ──(không upload)──► xử lý ──► file kết quả tải về máy               │
└─────────────────────────────────────────────────────────────────────────────────┘
                 │ HTTPS (chỉ metadata: auth, flow JSON, template, ref table, log)
                 ▼
┌────────────── Supabase (Free tier) ──────────────┐   ┌──── Cloudflare ────┐
│ Auth (username → email nội bộ, password)          │   │ Pages: host SPA    │
│ Postgres + RLS: users, groups, flows, versions…   │   │                    │
│ Storage: template .xlsx (private bucket)          │   │                    │
│ Edge Functions: admin-users (service role)        │   └────────────────────┘
└───────────────────────────────────────────────────┘
```

### 4.1 Lý do chọn hạ tầng

| Thành phần | Lựa chọn | Lý do | Lưu ý free tier |
|------------|----------|-------|-----------------|
| Hosting SPA | **Cloudflare Pages** | Free, **cho phép dùng thương mại**, CDN nhanh | Vercel Hobby **cấm dùng thương mại** → không chọn |
| Backend | **Supabase Free** | Auth + Postgres + RLS + Storage + Edge Functions trong 1 gói | Project tự **pause sau 7 ngày không hoạt động** → cần keep-alive (§16) ; DB 500MB, Storage 1GB |
| Keep-alive | GitHub Actions (schedule) | Free, không cần đăng nhập thêm dịch vụ | Ping 1 lần/ngày; GitHub tắt lịch nếu repo không hoạt động 60 ngày |

- Keep-alive Supabase do GitHub Actions thực hiện (không dùng Cloudflare Cron Worker, chốt 2026-10-26 20:27).
- Ref tables, Templates và Storage template thuộc Phase 2 (chốt 2026-10-26 22:52).

Kiến trúc giữ tính **portable**: frontend là static build; backend chỉ dùng chuẩn Postgres + Supabase Auth → có thể chuyển sang Supabase self-host (Docker) trong hạ tầng nội bộ của công ty khi cần.

---

## 5. Tech stack

| Lớp | Công nghệ | Ghi chú |
|-----|-----------|---------|
| Ngôn ngữ | TypeScript (strict) | |
| Build | Vite | |
| UI | React 19, Tailwind CSS v4, shadcn/ui | |
| Routing / server state | TanStack Router, TanStack Query | |
| Form & validation | React Hook Form + Zod | Zod cũng là nguồn sinh JSON Schema cho flow |
| Canvas flow | @xyflow/react (React Flow) + auto-layout tự viết (layered, trái → phải; không dùng ELK.js vì giấy phép EPL-2.0) | |
| Code editor | Monaco Editor (`monaco-editor` đóng gói cùng app, chốt 2026-10-27) | Highlight SQL / Python / formula, autocomplete tên view/cột/tham số. Chỉ lazy-load trong chunk Designer; editor worker same-origin (`worker-src 'self'`); font codicon self-host (`font-src 'self'`); **không dùng CDN loader**: cấu hình `@monaco-editor/loader` (hoặc tương đương) dùng bản `monaco-editor` đã bundle, không bao giờ tải từ jsDelivr hay domain ngoài |
| Data grid preview | TanStack Table + virtualization | Hiển thị hàng trăm nghìn dòng mượt |
| Chart | Apache ECharts | |
| Đọc Excel | SheetJS (bản CE từ cdn.sheetjs.com, vendor tại `vendor/`) | Đọc .xlsx, .xls (CSV không nhận, chốt 2026-10-26) |
| Ghi Excel | ExcelJS | Giữ style/format khi đổ vào template |
| Engine SQL | DuckDB-WASM (bundle `eh`, đơn luồng) | Chạy trong engine worker; tự host, tách file `.wasm` thành phần < 25 MiB (§13.1) |
| Định dạng cột | Apache Arrow JS (Apache-2.0) | Trao đổi bảng giữa engine (TS) và DuckDB |
| Engine Python | Pyodide (pandas, numpy) | Worker riêng, lazy load khi flow có node Python |
| Worker RPC | Comlink | |
| i18n | i18next + react-i18next | `vi` mặc định, cấu trúc sẵn `en` |
| Backend | Supabase (supabase-js v2) | |
| Test | Vitest, Playwright | |
| Lint/format | ESLint (flat config), Prettier | |

---

## 6. Xác thực (Authentication)

- **Đăng nhập bằng username + password**. Supabase Auth yêu cầu email → hệ thống map `username` → `username@users.hrflow.local` (email nội bộ, không gửi thư). UI chỉ hiện username.
- **Tắt public sign-up**. Chỉ Admin tạo tài khoản qua Edge Function `admin-users` (dùng service role key, kiểm tra người gọi là Admin).
- Tài khoản mới có cờ `must_change_password = true` → bắt đổi mật khẩu ở lần đăng nhập đầu.
- **Quên mật khẩu**: Admin reset → hệ thống sinh mật khẩu tạm, bật lại `must_change_password`.
- Chính sách mật khẩu: tối thiểu 10 ký tự, kiểm tra danh sách mật khẩu yếu (leaked password protection của Supabase nếu có trên free tier).
- Admin có thể **khóa** (disable) tài khoản; tài khoản bị khóa không đăng nhập được, session hiện tại bị thu hồi.
- Không có 2FA (theo yêu cầu). Có thể bổ sung TOTP sau (Supabase hỗ trợ sẵn).
- Session: access token ngắn hạn + refresh token, lưu trong `sessionStorage` (đóng tab là phải đăng nhập lại) (chốt 2026-10-26).

### 6.1 Tự đăng xuất khi không thao tác (bước 3, chốt 2026-10-26 22:52)

- **Ngưỡng**: 8 giờ không thao tác. Đếm hoàn toàn phía trình duyệt, áp dụng cho cả Admin và User.
- **Thao tác** = sự kiện chuột (`pointerdown`, `pointermove`), phím (`keydown`), cuộn (`wheel`, `scroll`), chạm (`touchstart`) **trong tab hiện tại**. Mỗi tab có phiên riêng (`sessionStorage`) nên đếm riêng theo tab. Sự kiện được gộp (throttle, tối đa 1 lần ghi nhận / 30 giây) để không ảnh hưởng hiệu năng.
- **Khi engine đang làm việc không tính là không thao tác**: trong lúc worker đang kiểm tra file, chạy flow, chạy xem trước node (Designer) hoặc xuất file, bộ đếm tạm dừng; khi tác vụ kết thúc (thành công, lỗi hoặc hủy), bộ đếm bắt đầu lại từ thời điểm kết thúc.
- **Đếm theo đồng hồ thực**: lưu thời điểm thao tác cuối (trong bộ nhớ) và so với `Date.now()`; kiểm tra lại khi tab hiện lại (`visibilitychange`) hoặc máy thức dậy. Nếu đã quá 8 giờ thì đăng xuất ngay, không hiện cảnh báo.
- **Cảnh báo trước 5 phút** (tại mốc 7 giờ 55 phút): dialog có đồng hồ đếm ngược và nút chính "Tiếp tục làm việc". Khi dialog đang mở, chỉ thao tác bấm nút (hoặc Enter khi nút có focus) mới gia hạn; di chuột không tự đóng dialog. Nếu Designer còn thay đổi chưa lưu, dialog nêu rõ: "Flow đang thiết kế còn thay đổi chưa lưu. Nếu bị đăng xuất, các thay đổi này sẽ mất." (không tự lưu, theo quyết định Designer không tự lưu).
- **Hết giờ**: gọi đăng xuất cục bộ (`signOut({ scope: 'local' })`: supabase-js vẫn gửi `POST /logout?scope=local` để server thu hồi refresh token của phiên này; tab/máy khác không bị ảnh hưởng). Xóa session trong `sessionStorage` ngay, chờ server tối đa 3 giây rồi chuyển trang dù request chưa xong (chốt 2026-10-27 12:30), kết thúc engine worker để giải phóng dữ liệu trong RAM (file đã upload, kết quả, file mẫu), bỏ qua cảnh báo "thay đổi chưa lưu" của Designer, chuyển về màn đăng nhập kèm thông báo: "Bạn đã được đăng xuất do không thao tác trong 8 giờ. Vui lòng đăng nhập lại."
- Không ghi thời điểm thao tác vào localStorage/server; không gửi sự kiện thao tác ra ngoài.
- Admin được tự reset mật khẩu, tự khóa, tự đổi role của mình; Admin thấy và chạy mọi flow đã publish (chốt 2026-10-26).

---

## 7. Data model (Supabase Postgres)

> Tất cả bảng bật RLS. Cột `created_at`, `updated_at`, `created_by` có ở mọi bảng (lược bỏ bên dưới cho gọn).

### 7.1 Danh sách bảng

| Bảng | Mô tả | Cột chính |
|------|-------|-----------|
| `profiles` | Thông tin user (1-1 với `auth.users`) | `id`, `username` (unique), `full_name`, `role` (`admin`/`user`), `is_active`, `must_change_password`, `locale` |
| `groups` | Nhóm user | `id`, `name`, `description` |
| `group_members` | User ↔ group | `group_id`, `user_id` |
| `flows` | Flow (định danh logic) | `id`, `code` (unique), `name`, `description`, `category`, `is_archived` |
| `flow_versions` | Phiên bản flow | `id`, `flow_id`, `version_no`, `status` (`draft`/`published`/`retired`), `effective_from` (date), `effective_to` (date, null = vô thời hạn), `definition` (jsonb), `schema_version`, `change_note`, `published_by`, `published_at` |
| `flow_assignments` | Gán flow cho user/group | `flow_id`, `user_id` *hoặc* `group_id` |
| `ref_tables` *(Phase 2)* | Bảng tham chiếu (định danh) | `id`, `code`, `name`, `columns` (jsonb: tên, kiểu) |
| `ref_table_versions` *(Phase 2)* | Phiên bản bảng tham chiếu | `id`, `ref_table_id`, `effective_from`, `effective_to`, `rows` (jsonb) *hoặc* `storage_path` (Parquet nếu lớn), `row_count`, `status` |
| `templates` *(Phase 2)* | Template Excel | `id`, `code`, `name`, `storage_path`, `sheets` (jsonb: metadata sheet/named range), `checksum` |
| `run_logs` | Nhật ký chạy (**không chứa nội dung dữ liệu**) | `id`, `user_id`, `flow_version_id`, `params` (jsonb), `inputs_meta` (jsonb: tên slot, số dòng, kích thước, SHA-256), `status`, `duration_ms`, `rows_out`, `error_code`, `error_node_id`, `client_info` |
| `audit_logs` | Nhật ký thao tác Admin | `id`, `actor_id`, `action`, `entity`, `entity_id`, `diff` (jsonb) |
| `app_settings` | Cấu hình hệ thống | `key`, `value` (jsonb) |

### 7.2 Ràng buộc quan trọng

- **Không chồng lấn effective date** giữa các version `published` của cùng flow / ref table: dùng exclusion constraint
  `EXCLUDE USING gist (flow_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (status = 'published')` (cần extension `btree_gist`).
- Version `published` là **bất biến (immutable)**: trigger `private.flow_versions_guard` chặn UPDATE `definition`; chỉ cho đổi `effective_to` và `status → retired`. Version `retired` không đổi được nữa; chỉ version `draft` được xóa. Không INSERT trực tiếp với `status = retired`.
- Mỗi flow tối đa 1 draft: unique index `flow_versions_one_draft_idx` (`where status = 'draft'`).
- `effective_to` là cận trên **không bao gồm** (`[from, to)`), phải lớn hơn `effective_from`. Version `published` bắt buộc có `effective_from`. Exclusion constraint `flow_versions_no_overlap` chỉ xét version `published` (version `retired` không còn tham gia kiểm tra chồng lấn).
- `run_logs.params` chỉ lưu tham số kiểu kỳ/chi nhánh; Admin đánh dấu tham số nhạy cảm (`log: false`) để không ghi log.

### 7.3 RLS (tóm tắt)

- Hàm `is_admin()` (security definer) đọc `profiles.role` của `auth.uid()`.
- Admin: toàn quyền trên các bảng cấu hình.
- User:
  - `flows`, `flow_versions`: chỉ SELECT bản `published` của flow được gán (trực tiếp hoặc qua group).
  - `ref_table_versions`, `templates`: chỉ SELECT những cái được flow họ có quyền tham chiếu.
  - `run_logs`: INSERT và SELECT bản ghi của chính mình.
  - `profiles`: SELECT/UPDATE bản ghi của chính mình (trừ `role`, `is_active`).

---

## 8. Flow definition (định dạng JSON)

Flow là một **DAG** (đồ thị có hướng, không vòng) gồm các node và edge. Schema được định nghĩa bằng Zod và có `schemaVersion` để migrate về sau.

```jsonc
{
  "schemaVersion": 1,
  "params": [
    { "key": "ky_luong", "label": "Kỳ lương", "type": "month", "required": true, "log": true },
    { "key": "chi_nhanh", "label": "Chi nhánh", "type": "select",
      "options": { "fromRefTable": "DM_CHI_NHANH", "valueColumn": "ma", "labelColumn": "ten" } }
  ],
  "nodes": [
    { "id": "in_luong", "type": "input.excel", "label": "Bảng lương",
      "config": { "slot": "bang_luong" } },
    { "id": "in_cc", "type": "input.excel", "label": "Chấm công",
      "config": { "slot": "cham_cong" } },
    { "id": "ref_pb", "type": "input.refTable", "config": { "refTable": "DM_PHONG_BAN" } },
    { "id": "j1", "type": "transform.join",
      "config": { "how": "left", "on": [{ "left": "ma_nv", "right": "ma_nv" }] } },
    { "id": "f1", "type": "transform.formula",
      "config": { "columns": [{ "key": "chenh_lech",
                  "formula": "=IF([cong_thuc_te]<>[cong_tinh_luong], [cong_thuc_te]-[cong_tinh_luong], 0)" }] } },
    { "id": "py1", "type": "code.python", "config": { "code": "def run(inputs, params):\n    ..." } },
    { "id": "out1", "type": "output.template",
      "config": { "template": "TPL_DOI_CHIEU", "mappings": [ /* §11 */ ] } }
  ],
  "edges": [
    { "from": "in_luong", "to": "j1", "toPort": "left" },
    { "from": "in_cc",    "to": "j1", "toPort": "right" },
    { "from": "j1",       "to": "f1" },
    { "from": "f1",       "to": "py1", "toPort": "df" },
    { "from": "py1",      "to": "out1" }
  ],
  "inputSlots": [ /* §10 */ ],
  "ui": { "positions": { "in_luong": [0, 0] } }
}
```

- Ví dụ trên minh họa định dạng đầy đủ, có cả node chưa thuộc bước 3 (`input.refTable`, `transform.formula`, `code.python`, `output.template`); danh sách node của bước 3 xem §12.
- `ui` chỉ phục vụ canvas, engine bỏ qua. Từ bước 3, `ui` gồm: `positions` (`{ [nodeId]: [x, y] }`), `notes` (sticky note: `{ id, text, position: [x, y], size?: [w, h] }[]`). Thay đổi chỉ trong `ui` không làm flow khác về nghiệp vụ (diff version bỏ qua, §14.3).
- Khi lưu: validate schema, kiểm tra DAG (không vòng), kiểm tra mọi port bắt buộc đã nối, kiểm tra tham chiếu (`refTable`, `template`, `slot`) tồn tại.

### 8.1 Tương thích schema (schema compatibility)

- Version đã Published là bất biến (§7.2) nên **mọi bản phát hành app sau này phải nạp được mọi version đã publish**.
- Thay đổi schema flow chỉ được phép theo 2 cách: (a) **bổ sung** (thêm trường tùy chọn có giá trị mặc định), hoặc (b) kèm một **bước tiền xử lý (preprocess migration)** trong `packages/flow-schema/src/migrate.ts` (`migrateFlowDefinition`) chuyển định nghĩa cũ sang dạng mới **trong bộ nhớ** trước khi parse (không sửa bản lưu trong database), và trả về ghi chú (notice) để hiển thị cho Admin.
- Engine (worker) luôn chạy `migrateFlowDefinition` trước `FlowDefinitionSchema` (lưới an toàn cho dữ liệu cũ đã lưu).
- Màn Import flow của Admin chạy `migrateFlowDefinition` trên file JSON trước khi publish và **lưu bản đã làm sạch** lên server (không lưu bản gốc); dialog hiển thị notice theo nhãn hiển thị của slot, VD "Đã bỏ định dạng .csv khỏi Bảng lương (không còn được hỗ trợ)." (chốt 2026-10-26).
- Bước tiền xử lý hiện có: bỏ `.csv` khỏi `inputSlots[].accept` (CSV không còn được nhận, chốt 2026-10-26 13:08); slot chỉ nhận `.csv` chuyển về mặc định `.xlsx, .xls`. Cả hai trường hợp đều có notice.

---

## 9. Xử lý dữ liệu: Excel · SQL · Python

Ba ngôn ngữ đều là **công dân hạng nhất**, ở hai mức:

| Mức | Excel | SQL | Python |
|-----|-------|-----|--------|
| **Cột tính toán** (node `transform.formula`) — mỗi công thức → 1 cột | `=IF([A]>0,[A]*0.1,0)` — người dùng chỉ viết công thức Excel, hệ thống tự transpile sang SQL DuckDB | (không có chế độ riêng; dùng `code.sql`) | (không có chế độ riêng; dùng `code.python`, P2) |
| **Node code** — nhận N bảng, trả về 1..N bảng | (không áp dụng) | `code.sql` | `code.python` |

### 9.1 Hàm Excel (chốt 2026-10-30 13:18)

- Mục tiêu: người không biết code thêm/sửa cột bằng công thức Excel quen thuộc; hệ thống tự transpile sang **SQL DuckDB** (không sang Python) → chạy vector hóa trên cả triệu dòng. Đặc tả node: §12.2.
- Danh sách hàm bản đầu (41 hàm: 40 hàm + `PARAM`):
  - Logic: `IF, IFS, AND, OR, NOT, SWITCH, IFERROR, ISBLANK, ISNUMBER`
  - Toán: `ROUND, ROUNDUP, ROUNDDOWN, INT, ABS, MIN, MAX, MOD, SUM` (theo dòng)
  - Chuỗi: `LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, PROPER, CONCAT, TEXTJOIN, SUBSTITUTE, FIND, SEARCH, VALUE`
  - Ngày: `DATE, YEAR, MONTH, DAY, EDATE, EOMONTH, DATEDIF, WEEKDAY`
  - Tham số: `PARAM("ky_luong")`
- Không làm ở bản đầu: `XLOOKUP`, `VLOOKUP` (tra cứu dùng `transform.join`, lấy đủ mọi dòng khớp); `TEXT`, `NETWORKDAYS`, `TODAY`, `IFNA` (để sau).
- Hàm chưa hỗ trợ → báo lỗi ngay khi Admin nhập, kèm gợi ý (VD XLOOKUP → dùng node Join; hàm khác → dùng `code.sql`), không lỗi lúc runtime.
- Golden test: kết quả mong đợi lấy từ **Excel thật** (§12.2, AC-B4-30).

### 9.2 SQL

- Dialect DuckDB. Mỗi input port của node `code.sql` xuất hiện dưới dạng một **view** cùng tên port do Admin đặt (VD `luong`, `cham_cong`). Chi tiết node: §12.1.8.
- Câu lệnh phải là một `SELECT`/`WITH … SELECT` duy nhất; kiểm tra bằng parser của DuckDB (không dùng regex): chặn `COPY`, `ATTACH`, `INSTALL`, `LOAD`, `EXPORT`, `PRAGMA`, `SET`, DDL/DML và các hàm đọc file/URL (`read_csv`, `read_parquet`, `read_json`…). Thêm một lớp chặn ở cấu hình DuckDB (§13.1: `enable_external_access = false`, khóa cấu hình).
- Tham số: `$ky_luong`, `$chi_nhanh` → bind bằng prepared statement, **chỉ dưới dạng giá trị**, không thay chuỗi vào câu SQL. Mọi tham số được bind dưới dạng `VARCHAR` theo định dạng chuẩn (`month` → `'2026-09'`, `date` → `'2026-09-15'`, `number` → `'1.5'`, `boolean` → `'true'`/`'false'`, `string`/`select` → nguyên giá trị; trống → `NULL`); Admin tự `CAST` khi cần (VD `CAST($ky_luong || '-01' AS DATE)`). Tham chiếu tới tham số không khai báo trong `params` → lỗi khi thiết kế.

### 9.3 Python

- Chạy bằng **Pyodide** trong Python Worker riêng; chỉ tải khi flow có node Python (lần đầu khoảng 10–30MB, sau đó được cache bằng Service Worker).
- Gói có sẵn: `pandas`, `numpy`, `python-dateutil`. Admin **không** cài thêm gói lúc runtime (tắt `micropip`) — danh sách gói được khai báo ở cấp hệ thống để kiểm soát.
- Hợp đồng hàm:

```python
import pandas as pd

def run(inputs: dict[str, pd.DataFrame], params: dict) -> pd.DataFrame | dict[str, pd.DataFrame]:
    df = inputs["df"]
    df["tham_nien_nam"] = (pd.Timestamp(params["ky_luong"]) - df["ngay_vao"]).dt.days // 365
    return df
```

- Trao đổi dữ liệu với DuckDB qua Arrow → hạn chế copy.
- Có timeout (mặc định 120 giây/node, cấu hình được) và nút Cancel (terminate worker).

### 9.4 Kiểu dữ liệu chuẩn

`string`, `integer`, `decimal`, `boolean`, `date`, `datetime`. Tiền lương, ngày công dùng `decimal` (không dùng float) để tránh sai số làm tròn.

Lưu trữ `decimal` bên trong engine: mỗi ô lưu dạng số double **chỉ khi** biểu diễn ngắn nhất của double đó trùng đúng giá trị thập phân (`String(x) === big.toString()`); ngược lại lưu dạng text chính xác. Đây chỉ là cách mã hóa không mất mát: đọc ô luôn trả về `Big`, mọi phép tính dùng big.js, không có phép tính nào trên double.

Ánh xạ giữa engine (TypeScript, big.js) và DuckDB (từ bước 3):

| Kiểu engine | Giá trị trong engine | Kiểu trong DuckDB | Quy tắc chuyển đổi |
|-------------|---------------------|-------------------|--------------------|
| `string` | `string` | `VARCHAR` | Nguyên văn |
| `integer` | `number` (safe integer) | `BIGINT` | Kết quả ngoài phạm vi safe integer → chuyển thành `decimal` |
| `decimal` | `Big` | `DECIMAL(38,10)` | Chuyển qua Arrow dưới dạng **chuỗi thập phân** rồi `CAST`; trước khi chuyển, engine làm tròn half-up về tối đa 10 chữ số thập phân. Chiều về: `CAST(... AS VARCHAR)` → `Big`. Không đi qua `DOUBLE` |
| `boolean` | `boolean` | `BOOLEAN` | Nguyên văn |
| `date` | `"YYYY-MM-DD"` | `DATE` | Qua chuỗi ISO |
| `datetime` | `"YYYY-MM-DDTHH:mm:ss"` | `TIMESTAMP` (không múi giờ) | Qua chuỗi ISO, cắt phần lẻ giây |

- Kết quả `DOUBLE`/`FLOAT` (VD phép chia, `AVG` trong `code.sql`) được nhận về thành `decimal` bằng quy tắc 15 chữ số có nghĩa giống số đọc từ Excel (`decimalFromNumber`); Designer hiển thị cảnh báo khuyên Admin `CAST(... AS DECIMAL(38,10))` cho cột đó.
- Kiểu DuckDB `HUGEINT`/`DECIMAL(p,s)` khác → `decimal`; `TIMESTAMP WITH TIME ZONE`, `INTERVAL`, `LIST`, `STRUCT`, `MAP`, `BLOB`, `UUID`… → lỗi `sql.error.unsupportedType` (kèm tên cột), Admin phải `CAST`.
- Vượt `DECIMAL(38,10)` (quá 28 chữ số phần nguyên) → lỗi `duckdb.error.decimalOverflow` kèm node và cột.

### 9.5 An toàn khi chạy code

- Chỉ Admin viết code; code nằm trong `flow_versions.definition` (đã publish, bất biến, có audit).
- Tham số do User nhập **chỉ được bind dưới dạng giá trị** (prepared statement / dict `params`), không bao giờ nối chuỗi vào code.
- **Content Security Policy** chặt: `connect-src` chỉ cho phép domain app + Supabase project + `blob:` (URL cục bộ dùng nạp DuckDB-WASM, không phải domain ngoài) → kể cả code Python/SQL cũng không gửi được dữ liệu ra ngoài. Chi tiết CSP: §17.
- Worker không có quyền truy cập DOM, token đăng nhập không được truyền vào worker.

---

## 10. Input slot & validation

Admin khai báo **input slot** cho mỗi flow — mô tả file mà User cần upload:

```jsonc
{
  "key": "bang_luong",
  "label": "Bảng lương tháng",
  "required": true,
  "accept": [".xlsx", ".xls"],                            // không nhận CSV (chốt 2026-10-26)
  "sheet": { "mode": "byName", "value": "Luong" },        // hoặc byIndex / firstMatchingHeaders
  "headerRow": 3,                                          // header ở dòng 3
  "headerRows": 1,                                         // >1 nếu header nhiều tầng → nối tên bằng " / "
  "dataStartRow": 4,
  "stopAt": { "blankRows": 2 },                            // dừng khi gặp 2 dòng trống liên tiếp
  "unmergeCells": "fillDown",
  "columns": [
    { "key": "ma_nv", "aliases": ["Mã NV", "MSNV", "Employee ID"], "type": "string",
      "required": true, "rules": [{ "unique": true }, { "regex": "<tùy Admin cấu hình>" }] },
    { "key": "luong_cb", "aliases": ["Lương CB", "Lương cơ bản"], "type": "decimal",
      "rules": [{ "min": 0 }] },
    { "key": "ngay_vao", "aliases": ["Ngày vào làm"], "type": "date",
      "dateFormats": ["dd/MM/yyyy", "excelSerial"] }
  ],
  "extraColumns": "drop",                                  // drop | keep
  "multiple": { "enabled": true, "minFiles": 1, "maxFiles": 50 }
}
```

- **Upload nhiều file vào một slot** (`multiple.enabled = true`): mỗi file được đọc và validate riêng theo cùng cấu hình, sau đó gộp dọc (union theo `key` cột). Hệ thống thêm cột hệ thống `_source_file` (tên file, chỉ tồn tại trong trình duyệt) để truy vết dòng lỗi về đúng file. Rule `unique` được kiểm tra trên **dữ liệu sau khi gộp**.
- Dòng không phải dữ liệu (dòng tổng cộng, dòng chữ ký…) bị loại theo `stopAt` hoặc rule `required` của cột khóa.
- Định dạng mã (VD Mã NV) **không fix cứng trong code**: Admin tự khai báo rule `regex` (tùy chọn) cho từng cột. Flow nghiệm thu chỉ dùng `required` + `unique` cho Mã NV (chốt 2026-10-26).
- Lỗi trùng giá trị giữa 2 file được gắn cho **cả 2 file** trong báo cáo và trạng thái từng file (chốt 2026-10-26).
- Tách 2 khái niệm cho mỗi cột:
  - `presence`: `required` (thiếu cột trong file → lỗi) | `optional`.
  - `required` (giá trị): ô trống → lỗi. Nếu không bắt buộc, ô trống nhận `defaultValue` (VD `0`) hoặc `null`.
  - Cột chỉ tiêu số trong flow nghiệm thu: `presence: required`, ô trống → `0`.
- Quy tắc đọc file bổ sung (chốt 2026-10-26):
  - `skipRows.whenKeyContains`: bỏ qua dòng có cột khóa chứa một trong các text cấu hình (VD `"TỔNG CỘNG"`), so khớp sau chuẩn hóa.
  - Thiếu cột khóa → chỉ 1 lỗi "thiếu cột"; không phát sinh lỗi từng dòng.
  - Số dạng text mơ hồ (VD `"1,500"`) → warning.
  - Cột `string` lấy text hiển thị của ô (giữ số 0 đầu, ngày theo format hiển thị).
  - Cột `date` luôn chấp nhận ô ngày thật của Excel, ngoài các `dateFormats` cấu hình.
  - File có header nhưng 0 dòng dữ liệu → warning.
  - Hai cột trùng tên (sau chuẩn hóa) khớp với một cột `presence: required` → error.

- So khớp tên cột: chuẩn hóa (bỏ dấu tiếng Việt, lowercase, bỏ khoảng trắng thừa) rồi so với `aliases`.
- **Báo cáo validation** trước khi chạy: thiếu cột, sai kiểu, vi phạm rule — kèm số dòng Excel gốc. Mỗi rule có mức `error` (chặn chạy) hoặc `warning` (cho chạy tiếp).
- Có thể tải báo cáo lỗi ra Excel để gửi lại cho người làm file.

---

## 11. Output

| Loại node | Mô tả |
|-----------|-------|
| `output.preview` | Bảng xem trước trong app (virtualized, sort/tìm kiếm phía client), không xuất file — bước 3, đặc tả §12.1.10 |
| `output.chart` | Biểu đồ ECharts (bar, line, pie, stacked, combo) cấu hình bằng form |
| `output.excel` | Xuất workbook nhiều sheet; format cơ bản: header đậm, freeze pane, auto-filter, độ rộng cột, number format theo kiểu dữ liệu |
| `output.template` | Đổ dữ liệu vào **template .xlsx** do Admin upload |

### 11.1 Template Excel

- Admin upload file .xlsx mẫu (logo, format, công thức tổng, chữ ký…). Lưu ở Supabase Storage (bucket private).
- Mapping hỗ trợ:
  - **Ô đơn** (scalar): `{ "cell": "B2", "value": "=PARAM(\"ky_luong\")" }` hoặc lấy giá trị tổng hợp từ một bảng.
  - **Vùng bảng** (table range): `{ "sheet": "BaoCao", "anchor": "A6", "source": "node_id", "columns": ["ma_nv", "ho_ten", …], "insertRows": true }` → chèn dòng, giữ style của dòng mẫu, tự mở rộng công thức tổng bên dưới.
  - **Named range / Excel Table** có sẵn trong template.
- Tên file output cấu hình được: `DoiChieu_{ky_luong}_{chi_nhanh}.xlsx`. Tham số kiểu tháng định dạng `YYYY-MM`, kiểu ngày `YYYY-MM-DD` trong tên file (VD `DoiChieu_2026-09.xlsx`) (chốt 2026-10-26).

---

## 12. Danh mục node (Node catalog)

Cột "Bước": **Đã có** = đã chạy được từ bước 1; **B3** = làm trong bước 3 (chốt 2026-10-26 22:52, bổ sung `output.preview` 2026-10-27); **Bước 4** = ngay sau bước 3; **P2**/**P3** = Phase 2/3; **Chưa chốt** = chưa xếp lịch.

| Nhóm | Node | Chức năng | Bước | Thực thi |
|------|------|-----------|------|----------|
| **Input** | `input.excel` | Đọc file từ input slot | Đã có | TS |
| | `input.refTable` | Bảng tham chiếu (tự chọn version theo effective date) | P2 | — |
| | `input.params` | Bảng 1 dòng chứa tham số runtime | Chưa chốt | — |
| **Cột** | `transform.select` | Chọn / đổi tên / sắp xếp thứ tự cột | **B3** | DuckDB |
| | `transform.formula` | Thêm/sửa cột bằng công thức Excel (§9.1, §12.2) | Bước 4 (chốt 2026-10-27) | DuckDB (transpile) |
| | `transform.cast` | Đổi kiểu dữ liệu | P2 | — |
| | `transform.split` / `transform.merge` | Tách / gộp cột | P2 | — |
| | `transform.fillDown` | Điền giá trị xuống (dữ liệu có ô merge) | P2 | — |
| **Dòng** | `transform.filter` | Lọc theo điều kiện (builder) | **B3** | DuckDB |
| | `transform.sort` | Sắp xếp | **B3** | DuckDB / TS (§12.1.3) |
| | `transform.dedupe` | Loại trùng theo khóa | **B3** | DuckDB |
| | `transform.sample` / `transform.limit` | Lấy mẫu / giới hạn số dòng | P2 | — |
| **Kết hợp** | `transform.join` | Inner / left / right / full / anti join | **B3** | DuckDB |
| | `transform.union` | Gộp dọc nhiều bảng (khớp theo tên cột) | **B3** | DuckDB |
| | `transform.lookup` | Tra cứu nhanh (giống XLOOKUP) | P2 | — |
| **Tổng hợp** | `transform.groupBy` | Group + SUM/COUNT/AVG/MIN/MAX/COUNT DISTINCT | **B3** | DuckDB |
| | `transform.pivot` / `transform.unpivot` | Xoay bảng | P2 | — |
| | `transform.window` | Running total, rank, lag/lead | P2 | — |
| **Kiểm soát** | `control.assert` | Kiểm tra điều kiện (VD: tổng lương 2 file khớp) → error/warning | P2 | — |
| | `control.compare` | Đối chiếu 2 bảng theo khóa → các bảng khớp / lệch / chỉ có ở A / chỉ có ở B | Đã có (§24.2) | TS |
| | `control.branch` | Chia luồng theo điều kiện tham số | P3 | — |
| **Code** | `code.sql` | SQL tùy chỉnh (§9.2) | **B3** | DuckDB |
| | `code.python` | Python tùy chỉnh (§9.3) | P2 | — |
| **Output** | `output.excel` | §11 | Đã có | TS |
| | `output.preview` | §11, §12.1.10 | **B3** | TS |
| | `output.chart`, `output.template` | §11 | P2 | — |
| **Tái sử dụng** | `subflow` | Nhúng một flow khác như một node | P3 | — |

Mỗi node type được định nghĩa bằng một **plugin** gồm: Zod schema cấu hình (trong `packages/flow-schema`), form cấu hình, hàm `compile` (sinh SQL DuckDB) hoặc `execute` (chạy trực tiếp bằng TypeScript), hàm suy diễn schema output. Nhờ vậy việc thêm node mới không đụng đến core engine.

### 12.1 Đặc tả node bước 3

**Quy ước chung**

- **Port**: node một đầu vào dùng input port `in`; node một đầu ra dùng output port `out`. Node `input.excel` giữ output port `table` (đã có).
- **Tham chiếu cột** bằng `key` của cột (snake_case, `IdentifierSchema`) trong schema suy diễn của node phía trước; `title` (tiêu đề hiển thị/Excel) đi kèm cột và được truyền xuống.
- **Kiểm tra lúc thiết kế**: `configSchema` (Zod) + `checkConfig` + `inferSchema` phát hiện cột không tồn tại, sai kiểu, trùng tên. Lỗi gắn `node_id` và đường dẫn trường cấu hình để Designer tô đỏ đúng ô; flow có lỗi không publish được (§14.4).
- **Mã lỗi** là i18n key theo dạng `<node>.error.<code>` / `<node>.warning.<code>` trong `locales/vi/engine.json` (VD `join.error.keyTypeMismatch`).
- **Giá trị hằng trong cấu hình** (VD giá trị lọc) và **tham số** luôn được bind dưới dạng giá trị của prepared statement; tên cột chỉ được đưa vào SQL sau khi kiểm tra khớp `IdentifierSchema` và đặt trong dấu nháy kép.
- **Thứ tự dòng tất định**: mỗi bảng đưa vào DuckDB có cột ẩn `__ord` (thứ tự dòng). Mọi node giữ nguyên thứ tự dòng đầu vào trừ khi quy định khác bên dưới; cột `__ord` không hiển thị cho Admin và không có trong view của `code.sql`.
- **Ô trống** (blank) = `null`; với cột `string`, chuỗi rỗng sau khi bỏ khoảng trắng cũng là trống.
- **Chuẩn hóa khóa** `normalizeKeys` (join, dedupe): dùng **đúng** quy tắc của `normalizeKeyPart` (`engine/core/keys.ts`): NFC, gộp mọi khoảng trắng Unicode, trim, lowercase — giống `control.compare` và rule `unique`. Bản SQL của quy tắc này phải cho kết quả trùng khớp với bản TS (golden test có NBSP, tab, chữ hoa có dấu tiếng Việt). Chỉ áp dụng cho cột `string`; cột kiểu khác so sánh theo giá trị. Mặc định bật (`true`), Admin tắt được (chốt 2026-10-27); áp dụng tương tự cho `normalizeText` của `transform.filter`.

#### 12.1.1 `transform.select`

- Port: `in` → `out`.
- Config: `{ columns: [{ from: string, key?: Identifier, title?: string }] }` (tối thiểu 1).
- Output schema: đúng các cột được liệt kê, theo thứ tự liệt kê; `key` mặc định = `from`; `title` mặc định = title của cột nguồn; kiểu giữ nguyên. Một cột nguồn có thể được chọn nhiều lần với `key` khác nhau.
- Lỗi: `select.error.unknownColumn` (cột nguồn không tồn tại), `select.error.duplicateKey` (2 cột output trùng `key`), `select.error.reservedKey` (`key` mới bắt đầu bằng `_`; cột hệ thống như `_source_file` chỉ được giữ nguyên tên).

#### 12.1.2 `transform.filter`

- Port: `in` → `out`.
- Config:
  ```ts
  {
    match: 'all' | 'any',            // mặc định 'all' (AND)
    conditions: [{                   // tối thiểu 1
      column: string,
      op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in'|'notIn'|'isBlank'|'notBlank'
        |'contains'|'notContains'|'startsWith'|'endsWith',
      value?: Literal | { param: Identifier },   // op so sánh 1 giá trị
      values?: Literal[]                          // op in / notIn (1..500 giá trị)
    }],
    normalizeText: boolean           // mặc định true: so sánh chuỗi sau chuẩn hóa như khóa
  }
  ```
  `Literal` = string | number | boolean; giá trị phải đọc được theo kiểu cột (`date` dạng `YYYY-MM-DD`, `decimal` dạng chuỗi thập phân).
- Ngữ nghĩa: `gt/gte/lt/lte` dùng cho `integer`, `decimal`, `date`, `datetime`, `string`; `contains/startsWith/endsWith` chỉ cho `string`. Ô trống chỉ thỏa `isBlank`, `neq`, `notIn`, `notContains`. Điều kiện dùng `{ param }` mà tham số để trống lúc chạy → điều kiện đó **bị bỏ qua** (cho phép tham số lọc tùy chọn, VD "Chi nhánh: tất cả").
- Output schema: giống đầu vào.
- Lỗi: `filter.error.unknownColumn`, `filter.error.opNotForType`, `filter.error.invalidValue`, `filter.error.unknownParam`.

#### 12.1.3 `transform.sort`

- Port: `in` → `out`.
- Config: `{ by: [{ column: string, direction: 'asc'|'desc' (mặc định 'asc'), blanks: 'first'|'last' (mặc định 'last') }] }` (tối thiểu 1).
- Sắp xếp ổn định: dòng bằng nhau giữ thứ tự cũ (`__ord`). Cột `string` sắp theo **bảng chữ cái tiếng Việt** bằng `Intl.Collator('vi')` (VD "Đ" sau "D", trước "E"), không phân biệt hoa thường (chốt 2026-10-27). Vì DuckDB-WASM không có collation tiếng Việt khi không tải extension ICU từ domain ngoài, node sort có cột `string` được thực thi phía TS (vật chất hóa bảng); sort chỉ trên cột không phải `string` chạy bằng DuckDB.
- Output schema: giống đầu vào.
- Lỗi: `sort.error.unknownColumn`.

#### 12.1.4 `transform.join`

- Port: `left`, `right` (bắt buộc) → `out`.
- Config:
  ```ts
  {
    how: 'inner' | 'left' | 'right' | 'full' | 'anti',   // anti = dòng của left không khớp right
    on: [{ left: string, right: string }],               // tối thiểu 1
    normalizeKeys: boolean,                              // mặc định true (chốt 2026-10-27)
    rightColumns?: string[],                             // cột lấy từ right; mặc định tất cả cột không phải khóa
    rightSuffix: string                                  // mặc định '_r'; regex ^_[a-z0-9_]+$
  }
  ```
- Output schema: toàn bộ cột của `left` (theo thứ tự), rồi các cột được chọn của `right`. Cột khóa xuất hiện một lần theo tên bên `left`; với `right`/`full`, giá trị khóa = giá trị bên left, nếu không có thì lấy bên right. Cột `right` trùng `key` với cột `left` → đổi thành `key + rightSuffix`; vẫn trùng → lỗi. `anti`: chỉ cột của `left`.
- Khớp khóa: ô trống không bao giờ khớp. Khóa `string` so sánh sau chuẩn hóa khi `normalizeKeys = true`. Hai khóa phải cùng kiểu (`integer` và `decimal` được coi là tương thích).
- Thứ tự dòng: theo `__ord` của left, rồi `__ord` của right; dòng chỉ có ở right (`right`/`full`) xếp sau, theo `__ord` của right.
- Nhiều–nhiều được phép; nếu một khóa bên left khớp nhiều dòng bên right → cảnh báo `join.warning.rowsMultiplied` (kèm số khóa bị nhân dòng, không kèm giá trị khóa trong log).
- Lỗi: `join.error.unknownColumn`, `join.error.keyTypeMismatch`, `join.error.columnConflict`.

#### 12.1.5 `transform.union`

- Port: `in_1` … `in_N` (đều bắt buộc, `N = inputCount`) → `out`. Số port phụ thuộc cấu hình (`inputPorts(config)`).
- Config: `{ inputCount: 2..10 (mặc định 2), missingColumns: 'null' | 'error' (mặc định 'null'), sourceColumn?: { key: Identifier, labels: string[] /* đúng N nhãn */ } }`.
- Khớp cột theo `key`. Thứ tự cột: theo `in_1`, sau đó các cột mới theo thứ tự xuất hiện ở các port sau. Cột thiếu ở một đầu vào → để trống (`'null'`) hoặc lỗi (`'error'`). `sourceColumn` thêm một cột `string` ghi nhãn của đầu vào cho từng dòng.
- Kiểu: phải giống nhau; `integer` + `decimal` → `decimal`; khác → `union.error.typeMismatch`.
- Thứ tự dòng: toàn bộ dòng `in_1`, rồi `in_2`… giữ thứ tự trong từng đầu vào.
- Ghi chú: gộp nhiều file **cùng một slot** đã do input slot thực hiện (§10); node này dùng để gộp các nhánh/slot khác nhau.
- Lỗi: `union.error.typeMismatch`, `union.error.missingColumn`, `union.error.duplicateKey` (trùng `sourceColumn.key`).

#### 12.1.6 `transform.groupBy`

- Port: `in` → `out`.
- Config:
  ```ts
  {
    by: string[],                         // 0..n cột nhóm; rỗng = 1 dòng tổng
    aggregations: [{                      // tối thiểu 1
      key: Identifier, title?: string,
      fn: 'sum'|'avg'|'min'|'max'|'count'|'countDistinct'|'countRows',
      column?: string                     // bắt buộc, trừ countRows
    }]
  }
  ```
- Kiểu kết quả: `sum(integer)` → `integer` (vượt safe integer → `decimal`); `sum(decimal)` → `decimal`; `avg` → `decimal`, tính chính xác: `SUM` và `COUNT` lấy từ DuckDB, phép chia bằng big.js, làm tròn half-up 10 chữ số thập phân; `min/max` → kiểu của cột (`integer`, `decimal`, `date`, `datetime`, `string`); `count`, `countDistinct`, `countRows` → `integer`.
- `min/max` trên cột `string` so theo mã ký tự (thứ tự nhị phân của DuckDB), **không** theo bảng chữ cái tiếng Việt như `transform.sort` (VD "Đặng" lớn hơn "Zung") (chốt 2026-10-27 13:06).
- Ô trống: bị bỏ qua trong mọi hàm (trừ `countRows`). `sum` của toàn ô trống = 0 (giống Excel SUM); `avg/min/max` của toàn ô trống = trống.
- Cột nhóm so sánh theo giá trị chính xác (không chuẩn hóa); ô trống tạo thành một nhóm riêng. Thứ tự dòng: theo lần xuất hiện đầu tiên của nhóm. `by` rỗng luôn ra đúng 1 dòng, kể cả khi đầu vào 0 dòng.
- Output schema: các cột `by` (giữ kiểu, title) rồi các cột tổng hợp theo thứ tự cấu hình.
- Lỗi: `groupBy.error.unknownColumn`, `groupBy.error.fnNotForType`, `groupBy.error.duplicateKey`.

#### 12.1.7 `transform.dedupe`

- Port: `in` → `out` (dòng giữ lại), `removed` (dòng bị loại, tùy chọn nối).
- Config: `{ keys: string[] (tối thiểu 1), keep: 'first' | 'last' (mặc định 'first'), normalizeKeys: boolean (mặc định true, chốt 2026-10-27) }`.
- Hai dòng trùng khi mọi cột khóa bằng nhau (cột `string` so sánh sau chuẩn hóa nếu bật). Dòng có **toàn bộ** cột khóa trống không bị coi là trùng (luôn giữ lại).
- Output schema: cả hai port giống đầu vào; thứ tự dòng giữ theo đầu vào.
- Lỗi: `dedupe.error.unknownColumn`.

#### 12.1.8 `code.sql`

- Port: một input port cho mỗi phần tử `inputs` (bắt buộc) → `out`.
- Config: `{ inputs: [{ port: Identifier }] (1..10, không trùng), sql: string (1..100.000 ký tự) }`.
- Thực thi: mỗi input port là một view tên = `port`, cột = `key` của schema đầu vào (không có `__ord`), kiểu theo §9.4. Tham số `$key` theo §9.2. Câu lệnh được kiểm tra theo §9.2 trước khi chạy. Thứ tự dòng kết quả = thứ tự DuckDB trả về; muốn ổn định phải có `ORDER BY` (Designer nhắc khi câu lệnh không có `ORDER BY` ở cấp ngoài cùng).
- Output schema: suy ra bằng `DESCRIBE` câu lệnh trên các bảng rỗng có đúng schema đầu vào (không cần file mẫu; cần DuckDB đã tải trong worker của Designer). Tên cột kết quả phải khớp `IdentifierSchema`, không trùng; cột không bắt đầu bằng `_` trừ khi trùng tên một cột hệ thống của đầu vào. `title` = title của cột đầu vào cùng `key` nếu có, ngược lại = `key`. Kiểu theo §9.4.
- Lỗi: `sql.error.syntax`, `sql.error.notSelect`, `sql.error.multipleStatements`, `sql.error.forbidden`, `sql.error.unknownParam`, `sql.error.invalidColumnName`, `sql.error.duplicateColumn`, `sql.error.unsupportedType`, `sql.error.runtime`. Thông báo gốc của DuckDB (có thể trích giá trị ô) **chỉ hiển thị trên UI** của máy đang chạy, rút gọn tối đa 500 ký tự; không ghi console, không vào `run_logs` (`run_logs.error_code` chỉ chứa key, VD `sql.error.runtime`).

#### 12.1.9 Node đã có trong Designer

- `input.excel`: config `{ slot }`; output schema = các cột của slot (`key`, `type`; `title` = `label`, không có thì alias đầu tiên) + `_source_file` (string) khi slot nhận nhiều file. Với `extraColumns: 'keep'`, cột thêm không biết trước nên không có trong schema thiết kế: chúng chỉ dùng được trong `code.sql` lúc chạy (qua view của input port), các node transform khác không chọn được; Designer hiện cảnh báo `inputExcel.warning.extraColumnsRuntimeOnly` trên node `input.excel` của slot đó (chốt 2026-10-27). `DESCRIBE` của `code.sql` lúc thiết kế không thấy các cột này, nên câu SQL tham chiếu tới chúng được kiểm tra lại lúc chạy.
- `control.compare` (§24.2): giữ thực thi TS; output schema 4 port như hiện có.
- `output.excel` (§11): mỗi sheet là một input port (`sheets[].port`); không có output port.

#### 12.1.10 `output.preview` (bước 3, chốt 2026-10-27)

- Port: `in` (bắt buộc); không có output port. Muốn xem nhiều bảng → dùng nhiều node `output.preview`.
- Config:
  ```ts
  {
    title: string,                 // 1..60 ký tự, tên tab trên màn Kết quả; không trùng (không phân biệt hoa thường)
                                   // với title của output.preview khác và tên sheet của output.excel
    columns?: string[],            // cột hiển thị theo thứ tự; mặc định toàn bộ cột đầu vào
    maxRows: number                // số dòng giữ để hiển thị; 1..1.000.000, mặc định 100.000
  }
  ```
- Thực thi (TS): giữ bảng đầu vào (chỉ các cột `columns`) trong **bộ nhớ của engine worker** làm kết quả hiển thị; bảng vượt `maxRows` → chỉ giữ `maxRows` dòng đầu và gắn cờ bị cắt. Không tạo artifact, không tạo file, không bao giờ gửi ra khỏi trình duyệt; `run_logs` chỉ ghi số dòng như các output khác.
- Màn Kết quả của Run Wizard: mỗi `output.preview` là **một tab** cùng hàng với các tab sheet của `output.excel`, xếp theo thứ tự node trong flow; tab preview có nhãn phụ "Chỉ xem" để phân biệt với sheet có trong file tải về. Bảng virtualized, main thread chỉ lấy từng trang dòng từ worker (như sheet hiện có), có sort theo cột và tìm kiếm phía client. Bị cắt → callout "Đang hiển thị 100.000 / 250.000 dòng đầu." Flow chỉ có `output.preview` (không có `output.excel`) → màn Kết quả không có nút tải file.
- Kết quả preview nằm trong bộ nhớ cùng kết quả lần chạy (nút "Xem kết quả", MEMORY 13:08); bị giải phóng khi chạy lần mới, đổi flow, đóng tab hoặc tự đăng xuất.
- Trong Designer, xem trước node này (§13.3) hiển thị 200 dòng đầu như các node khác.
- Output schema: không có (node cuối). Lỗi: `preview.error.unknownColumn`, `preview.error.duplicateTitle`.

### 12.2 Đặc tả node bước 4: `transform.formula` (chốt 2026-10-30 13:18)

Áp dụng toàn bộ quy ước chung của §12.1 (port, `__ord`, mã lỗi i18n, bind giá trị, tên cột qua `IdentifierSchema` + nháy kép).

**Config**

```ts
{
  columns: [{                        // 1..50, tính tuần tự từ trên xuống
    key: Identifier,                 // cột mới, hoặc key của cột có sẵn để ghi đè
    title?: string,                  // mặc định: title cột bị ghi đè, hoặc = key
    formula: string,                 // bắt đầu bằng "=", tối đa 2.000 ký tự; lưu dạng chuẩn hóa [key]
    type?: 'auto' | 'string' | 'integer' | 'decimal' | 'boolean' | 'date',   // mặc định 'auto'
    onError?: 'blank' | 'fail'       // mặc định 'blank'
  }]
}
```

**Cú pháp**

- Tham chiếu cột: `[Tiêu đề]` hoặc `[key]`. Khi lưu, Designer chuẩn hóa về `[key]`; khi hiển thị đổi lại theo tiêu đề hiện tại. Tiêu đề trùng nhau giữa 2 cột → `formula.error.ambiguousTitle` (dùng `[key]`). Ký tự `]` trong tiêu đề viết là `]]` (như Excel Table).
- Phạm vi tham chiếu: cột của đầu vào + cột đã định nghĩa **phía trên** trong cùng node. Tham chiếu cột phía dưới → `formula.error.forwardReference`. Cột đang ghi đè tham chiếu chính nó → lấy giá trị **cũ** (VD `luong = [luong]*1.1`). Cột thêm của slot `extraColumns: 'keep'` không dùng được (§12.1.9).
- Toán tử: `+ - * / ^ & = <> < > <= >=`, dấu trừ một ngôi, `%` hậu tố, ngoặc. Thứ tự ưu tiên như Excel. Tên hàm không phân biệt hoa thường; độ sâu lồng tối đa 64.
- Hằng: số, chuỗi `"..."` (`""` để viết dấu nháy), `TRUE`/`FALSE`. Dấu phân cách đối số là `,`, dấu thập phân là `.` (chốt 2026-10-30 13:24, Q17); gõ `;` → `formula.error.syntax` kèm gợi ý dùng `,` và `.`.
- Tham số: `PARAM("ten")` — tên phải khai báo trong `params`, nếu không → `formula.error.unknownParam`. Kiểu: `month` → `date` (ngày 1 của tháng), `date` → `date`, `number` → `decimal`, `boolean` → `boolean`, `string`/`select` → `string`; để trống → trống.
- Hàm ngoài danh sách §9.1 → `formula.error.unknownFunction` (kèm gợi ý: XLOOKUP/VLOOKUP → node Join; còn lại → `code.sql`). Sai số đối số → `formula.error.argCount`; sai cú pháp → `formula.error.syntax` kèm vị trí ký tự.

**Ngữ nghĩa**

- **Ô trống**: là 0 khi làm toán hạng của toán tử số hoặc đối số số của hàm; là `""` khi nối chuỗi / đối số chuỗi; `ISBLANK` đúng; `[A]=""` và `[A]=0` đều đúng. Kết quả của cả công thức là **một tham chiếu cột trần** (VD `=[A]`, hoặc nhánh `IF` trả về `[A]`) mà ô trống → kết quả trống.
- **Số**: mọi phép tính trên `DECIMAL(38,10)`, không qua `DOUBLE` (§9.4). Phép chia làm tròn half-up về 10 chữ số thập phân. `ROUND` làm tròn ra xa số 0 (half away from zero) như Excel; `ROUNDUP`/`ROUNDDOWN` ra xa / về phía số 0. `^` với số mũ là hằng nguyên (|n| ≤ 64) tính chính xác; số mũ không nguyên hoặc lấy từ cột dùng quy tắc 15 chữ số có nghĩa (`decimalFromNumber`) (chốt 2026-10-30 17:32). Tràn `DECIMAL(38,10)` → lỗi `#NUM!`.
- **So sánh chuỗi** không phân biệt hoa thường (như Excel), không bỏ khoảng trắng. `FIND` phân biệt hoa thường; `SEARCH` không phân biệt, hỗ trợ `*`, `?`, `~`.
- **Chuyển kiểu ngầm** như Excel: chuỗi đọc được là số (chỉ dạng `1.5`, `-2`, `1e3`; không nhận "1,500", "50%", chữ ngày — chốt 2026-10-30 17:32) thì dùng như số trong phép toán và trong `VALUE`, không đọc được → `#VALUE!`; `TRUE`/`FALSE` = 1/0 trong phép toán.
- **Ngày**: `date ± số` → `date`; `date − date` → số ngày; `DATEDIF` hỗ trợ `"Y","M","D","MD","YM","YD"`; `WEEKDAY` hỗ trợ `return_type` 1, 2, 3. Kết quả ngoài 1900-01-01…9999-12-31 → `#NUM!`.
- **Hành vi chi tiết từng hàm** theo Excel; golden test với Excel thật là chuẩn đối chiếu khi có khác biệt.
- **Suy diễn kiểu** (`type: 'auto'`): theo kiểu kết quả của biểu thức; số → `decimal` (Admin đổi được sang `integer`, khi đó giá trị không nguyên → lỗi `#VALUE!`). Các nhánh `IF`/`IFS`/`SWITCH` khác kiểu (số và chữ) → kiểu `string` kèm cảnh báo `formula.warning.mixedTypes`. Admin chọn `type` khác kiểu suy diễn mà không chuyển được → `formula.error.typeMismatch` lúc thiết kế: `date`, `boolean` chỉ nhận biểu thức đúng kiểu đó; `decimal`, `integer`, `string` nhận mọi kiểu. Key bắt đầu bằng `_` → `formula.error.reservedKey` (chốt 2026-10-30 17:32).
- **Lỗi lúc chạy** (`#DIV/0!`, `#VALUE!`, `#NUM!`): `IFERROR` bắt được. Không được bắt:
  - `onError: 'blank'` → ô kết quả trống; cảnh báo `formula.warning.rowErrors` gồm cột, số dòng theo từng loại lỗi, tối đa 5 số dòng (thứ tự dòng đầu vào, đếm từ 1); **không** chứa giá trị ô.
  - `onError: 'fail'` → dừng lần chạy, lỗi `formula.error.rowError` kèm node, cột, loại lỗi, số dòng đầu tiên.
- **Output schema**: cột đầu vào giữ nguyên thứ tự; cột ghi đè giữ vị trí, đổi kiểu/title theo cấu hình; cột mới thêm cuối theo thứ tự khai báo. Thứ tự dòng giữ nguyên.
- **Bảo mật**: hằng chuỗi/số và tham số luôn bind dưới dạng giá trị của prepared statement; công thức không bao giờ được nối thẳng thành chuỗi SQL ngoài tên cột đã kiểm tra. Transpiler chỉ sinh SQL từ danh sách hàm cho phép (whitelist), không có đường đi cho SQL tùy ý.

**Designer**

- Mỗi cột một dòng trong form: key, tiêu đề, ô công thức (Monaco), kiểu (Select, hiện kiểu suy diễn), `onError`.
- Ô công thức: tô màu cú pháp; gõ `[` → gợi ý cột (theo tiêu đề, kèm key và kiểu); gõ tên hàm → gợi ý hàm + tooltip cú pháp/mô tả tiếng Việt; lỗi gạch đỏ đúng vị trí, kiểm tra lại 300 ms sau khi ngừng gõ. Monaco chỉ nằm trong chunk Designer.
- Bảng tra "Hàm hỗ trợ" (nhóm, cú pháp, ví dụ); nút "Xem SQL đã sinh" (chỉ đọc).
- Xem trước: cơ chế xem trước node có sẵn (§13.3).
- Lỗi thiết kế tô đỏ đúng cột/trường; flow có lỗi không publish được (§14.4).

---

## 13. Execution engine

1. **Resolve**: chọn `flow_version` theo **ngày hiệu lực** (§14), tải ref table và template tương ứng.
2. **Validate**: schema flow, input slot, tham số.
3. **Plan**: topological sort; gom các node SQL/Excel liên tiếp thành một câu SQL (pushdown) để DuckDB tối ưu.
4. **Execute**: chạy từng stage trong worker; node Python chuyển dữ liệu qua Arrow sang Python Worker.
5. **Report**: tiến độ theo node (%, số dòng), thời gian, warning; lỗi gắn với `node_id`.
6. **Output**: build file Excel và trả về dạng Blob để tải xuống.
7. **Log**: ghi `run_logs` (metadata, §7.1).

Đặc điểm:
- **Cancel** bất kỳ lúc nào (terminate worker; khởi động lại worker và kiểm tra lại file, chốt 2026-10-26 13:08).
- **Giới hạn bộ nhớ**: WASM 32-bit ≈ 4GB/tab. Mục tiêu thiết kế: ổn định tới **1 triệu dòng × 50 cột**. Bảng trong engine lưu dạng cột (columnar, dựa trên Arrow) thay cho mảng object theo dòng, để vừa heap JS của trình duyệt (~3,8 GB) và tránh chi phí GC; bước 3 chỉ hoàn tất khi 1 triệu dòng × 30 cột chạy được không crash (chốt 2026-10-27). Flow cảnh báo khi file vượt ngưỡng do Admin cấu hình (`maxRows` mỗi slot). Việc chuyển bảng sang DuckDB tạo thêm một bản sao dữ liệu; engine giải phóng bảng TS trung gian ngay khi không còn node nào cần.
- File rất lớn: .xlsx được đọc theo luồng (giải nén từng phần bằng `DecompressionStream`, quét XML thành lưới gọn; giá trị ô giống SheetJS); .xls và file lạ dùng SheetJS (chỉ khi < 64 MB). Kết quả > 2 triệu ô ghi bằng bộ ghi theo luồng, cùng bố cục với ExcelJS. Không nhận CSV (chốt 2026-10-26).
- Bảng trong engine lưu theo cột (mỗi cột một vector typed array kiểu Arrow; chữ/ngày là UTF-8 + offset). Đo trên Chromium (30 cột): 100k dòng đọc + chạy ≈ 8–10 giây; 1 triệu dòng đọc ≈ 68 giây, chạy ≈ 25 giây, không crash.

### 13.1 DuckDB-WASM runtime (bước 3, chốt 2026-10-26 22:52)

**Lưu trữ và tải**

- DuckDB-WASM được **tự host** trên Cloudflare Pages cùng app; không tải từ CDN/domain ngoài, CSP không thêm domain (chốt 2026-10-27 07:31).
- Dùng bundle `eh` (đơn luồng, không cần `SharedArrayBuffer`/COOP/COEP). File `.wasm` (~34 MB) vượt giới hạn 25 MiB/file của Cloudflare Pages nên **lúc build** được tách thành các phần `< 25 MiB` (VD `duckdb-eh.wasm.part0`, `.part1`) kèm manifest `duckdb-manifest.json`: `{ version, totalBytes, sha256, parts: [{ file, bytes, sha256 }] }`. Script build kiểm tra mọi file trong `dist/` đều `< 25 MiB`.
- Engine worker tải các phần (same-origin), kiểm tra SHA-256 từng phần và toàn bộ file sau khi ghép, rồi khởi tạo DuckDB. Sai checksum → xóa cache, tải lại 1 lần; vẫn sai → lỗi `duckdb.error.loadFailed` (không chạy flow).
- Cache bằng **Cache Storage** (khóa theo `version` + `sha256` của manifest); phiên bản mới tự thay cache cũ. Cache Storage chỉ chứa file WASM, không bao giờ chứa dữ liệu.
- **Tải lười**: DuckDB chỉ được tải khi flow có ít nhất một node chạy bằng DuckDB (§12) — kể cả khi chạy, xem trước, hoặc Designer cần suy diễn schema `code.sql`. Flow chỉ gồm `input.excel` / `control.compare` / `output.excel` (như flow nghiệm thu) không tải DuckDB. Trong lúc tải hiển thị tiến độ "Đang tải bộ xử lý dữ liệu (lần đầu khoảng 34 MB)".
- File `.wasm` đã ghép và qua kiểm tra checksum được cấp cho DuckDB bằng **URL `blob:` cục bộ** (`URL.createObjectURL`, tạo trong worker, thu hồi bằng `URL.revokeObjectURL` sau khi khởi tạo xong). Vì DuckDB tải module qua `fetch`, CSP `connect-src` thêm `blob:` — chỉ là URL cục bộ, không thêm domain ngoài (chốt 2026-10-27 07:31). **Phải sửa `apps/web/public/_headers`** cho khớp §17 trong cùng thay đổi.

**Cấu hình an toàn** (đặt ngay sau khi mở kết nối, rồi khóa)

- Database `:memory:` (không OPFS, không file); `enable_external_access = false`; `autoinstall_known_extensions = false`; `autoload_known_extensions = false`; `lock_configuration = true`.
- Không có dữ liệu nào được lưu bền vững: đóng tab / terminate worker là mất.

**Thực thi**

- DuckDB nằm trong engine worker (hoặc worker con do engine worker tạo); dữ liệu không đi qua main thread.
- Ranh giới TS ↔ DuckDB: bảng TS (`Table`, §9.4) được chuyển sang Arrow (cột `decimal` dạng chuỗi), đăng ký vào DuckDB rồi tạo bảng có kiểu chuẩn (`CAST`) và cột `__ord`. Kết quả cần đưa về TS được đọc qua Arrow và chuyển ngược theo §9.4.
- **Gộp node SQL liên tiếp** (pushdown): chuỗi node DuckDB liên tiếp được biên dịch thành view/CTE và chỉ vật chất hóa (materialize) khi: node kế tiếp chạy bằng TS (`control.compare`, `output.excel`, `output.preview`, `transform.sort` có cột `string`), output được xem trước, hoặc một output được nhiều node dùng.
- Mỗi node vẫn báo tiến độ riêng (số dòng output); khi gộp, số dòng được đếm khi vật chất hóa.
- Hủy: terminate worker (DuckDB-WASM không ngắt được câu lệnh đang chạy).

### 13.2 Schema inference (bước 3)

- Danh sách cột ở mỗi node được suy ra từ **định nghĩa input slot** và cấu hình node (`inferSchema` theo §12.1), **không cần file mẫu** (chốt 2026-10-26 22:52). Chạy trong worker mỗi khi flow trên canvas thay đổi (debounce ~300 ms).
- Kết quả dùng cho: dropdown chọn cột trong form node, autocomplete trong SQL editor, phát hiện lỗi tên cột/kiểu ngay khi thiết kế, hiển thị số cột trên node.
- Node lỗi → các node phía sau hiển thị "Chưa xác định được cột (node phía trước đang lỗi)" thay vì báo lỗi dây chuyền.
- `code.sql` cần DuckDB để `DESCRIBE`; khi DuckDB chưa tải xong, schema của node hiển thị trạng thái "Đang xác định cột…". Hợp đồng plugin cho phép `inferSchema` bất đồng bộ cho node này.

### 13.3 Xem trước từng node trong Designer (bước 3, chốt 2026-10-26 22:52)

- Admin chọn **file mẫu** cho từng input slot trong panel dữ liệu của Designer. File chỉ nằm trong RAM của worker: không upload, không lưu localStorage/IndexedDB, không ghi `run_logs`. Đóng Designer, đóng tab hoặc tự đăng xuất là mất.
- Bấm "Xem trước" trên node đang chọn → engine chạy **chỉ các node tổ tiên** của node đó và chính node đó (theo bản flow hiện tại trên canvas, kể cả chưa lưu), với tham số do Admin nhập trong panel (mặc định: giá trị trống; tham số bắt buộc chưa nhập → yêu cầu nhập).
- Hiển thị **200 dòng đầu** của mỗi output port kèm tổng số dòng; node `control.compare` hiển thị cả 4 bảng (tab: Tổng hợp / Lệch / Chỉ có trong A / Chỉ có trong B). Node `output.excel` xem trước dưới dạng danh sách sheet + 200 dòng đầu mỗi sheet, không tạo file tải về.
- Kết quả kiểm tra file mẫu (validation report) hiển thị như ở Run Wizard; slot có lỗi `error` thì các node phụ thuộc không chạy được và báo rõ slot nào lỗi.
- Kết quả trung gian của lần xem trước được giữ trong worker; lần xem trước tiếp theo chỉ chạy lại các node có cấu hình (hoặc tổ tiên) đã thay đổi. Có thể đơn giản hóa thành chạy lại toàn bộ tổ tiên nếu cần (xem báo cáo phân việc).
- Xem trước không yêu cầu flow đã lưu và không ghi gì lên server.

---

## 14. Versioning theo Effective Date

Áp dụng cho **flow** và **bảng tham chiếu** (bảng tham chiếu từ Phase 2). Bước 3 làm màn Version cho flow (chốt 2026-10-26 22:52).

### 14.1 Vòng đời

```
Draft ──(Publish + chọn effective_from)──► Published ──(hết hiệu lực / thay thế)──► Retired
  ▲                                            │
  └────────────(Clone thành draft mới)─────────┘
```

- Mỗi flow có tối đa **1 draft** đang mở (unique index, §7.2).
- Publish yêu cầu: `effective_from` (bắt buộc), `effective_to` (tùy chọn, không bao gồm), `change_note` (bắt buộc, không rỗng sau khi bỏ khoảng trắng, tối đa 1000 ký tự).
- Khi publish version mới có `effective_from = D` và version trước đang mở (`effective_to = null`, `effective_from < D`) → dialog đề xuất tự đặt `effective_to = D` cho version đó (checkbox bật sẵn, Admin bỏ chọn được). Đóng version trước và publish thực hiện **trong cùng một giao dịch**.
- Không cho phép khoảng hiệu lực chồng nhau (constraint DB, §7.2). Cho phép **khoảng trống** nhưng cảnh báo.
- **Retire**: chuyển version `published` sang `retired` (có xác nhận). Version retired không còn được chọn khi chạy và không tham gia kiểm tra chồng lấn; không thể đưa lại thành published (muốn dùng lại → rollback).
- **Rollback** = tạo draft từ nội dung của một version cũ rồi publish thành version mới với effective date mới (không sửa lịch sử). Nếu flow đang có draft, phải lưu/publish hoặc hủy draft đó trước.
- **Hủy draft**: xóa draft (có xác nhận); chỉ draft được xóa (trigger, §7.2) Số version = max(version_no) + 1 nên draft mới sau khi hủy có thể dùng lại số của draft đã hủy; chấp nhận vì draft chưa từng publish nên không có run log trỏ tới (chốt 2026-10-27).

### 14.2 Quy tắc chọn version khi chạy

- **Ngày tham chiếu (as-of date)** = giá trị của tham số mà Admin đánh dấu `isAsOfDate` (VD: `ky_luong` → ngày đầu tháng của kỳ). Nếu flow không có tham số này → dùng ngày hiện tại.
- Version được chọn: `effective_from <= as_of < coalesce(effective_to, +∞)`.
- Ref table trong flow cũng được chọn theo **cùng as-of date** → chạy lại kỳ cũ cho ra kết quả nhất quán với quy định của kỳ đó (VD: biểu thuế TNCN, mức lương tối thiểu vùng).
- Không có version hiệu lực → báo lỗi rõ ràng: "Flow chưa có phiên bản hiệu lực cho kỳ 03/2025".
- Run log lưu `flow_version_id` và version của các ref table đã dùng → có thể truy vết (audit).

### 14.3 So sánh version

Màn Version có chức năng **diff** giữa 2 version bất kỳ của cùng flow (kể cả draft), làm trong bước 3 (chốt 2026-10-26 22:52). Mặc định so version được chọn với version liền trước.

- **Node**: so theo `id` → danh sách **thêm** / **xóa** / **sửa** (đổi `type`, `label` hoặc `config`). Node bị sửa hiển thị cấu hình JSON **side-by-side** (trái: version cũ, phải: version mới), khóa object sắp theo thứ tự cố định, dòng khác nhau được tô màu (coral = bỏ, teal = thêm). Chuỗi nhiều dòng (VD `sql` của `code.sql`) hiển thị theo từng dòng để dễ đọc.
- **Edge**: liệt kê kết nối thêm/xóa (`from.fromPort → to.toPort`).
- **Tham số** (`params`) và **input slot** (`inputSlots`): so theo `key` → thêm / xóa / sửa, phần sửa hiển thị JSON side-by-side như node.
- Bỏ qua khác biệt chỉ nằm trong `ui` (vị trí node, sticky note). Hai version giống nhau về nghiệp vụ → thông báo "Hai phiên bản giống nhau về nội dung xử lý".
- Diff tính hoàn toàn phía trình duyệt trên `definition` (cấu hình flow, không chứa dữ liệu nhân sự).

### 14.4 Màn Version & hiệu lực (Admin, bước 3)

Truy cập từ danh sách flow của Admin và từ Designer (wireframe màn 6).

- **Danh sách version** (mới nhất trên cùng): số version, trạng thái (chip: Draft = blue, Published = teal, Retired = xám trung tính), khoảng hiệu lực "từ dd/MM/yyyy đến trước dd/MM/yyyy" (hoặc "từ dd/MM/yyyy, không thời hạn"), cùng cách hiển thị với màn Flow hiện có, ghi chú thay đổi, người và thời điểm publish. Version đang hiệu lực hôm nay được đánh dấu "Đang áp dụng".
- **Dải thời gian hiệu lực** (timeline) các version published; **khoảng trống** giữa các version (và sau version cuối nếu nó có `effective_to`) hiện cảnh báo amber: "Từ 01/03/2026 đến 31/03/2026 không có phiên bản hiệu lực. User chạy kỳ này sẽ bị báo lỗi."
- **Hành động** theo trạng thái:

| Trạng thái | Hành động |
|------------|-----------|
| Draft | Mở Designer · Publish · Hủy draft · So sánh |
| Published | Xem trong Designer (chỉ xem, chốt 2026-10-29) · Tạo draft từ version này (rollback/sửa tiếp) · Đổi ngày kết thúc (`effective_to`) · Retire · So sánh · Xuất JSON |
| Retired | Xem trong Designer (chỉ xem) · Tạo draft từ version này · So sánh · Xuất JSON |

- **Dialog Publish**: "Hiệu lực từ ngày" (`effective_from`, DatePicker, bắt buộc), "Hiệu lực đến trước ngày" (`effective_to`, tùy chọn, phải sau ngày bắt đầu; cận không bao gồm, cùng cách nhập với dialog Import flow đã có), "Ghi chú thay đổi" (`change_note`, bắt buộc), checkbox "Đặt v{n} hiệu lực đến trước ngày {D}" khi có version mở (§14.1). Trước khi gửi: chạy kiểm tra đầy đủ của engine (`planFlow` + `checkConfig` + `inferSchema`); còn lỗi → không cho publish, liệt kê lỗi theo node. Hiển thị trước cảnh báo khoảng trống nếu publish tạo ra khoảng trống. Lỗi chồng lấn từ DB (SQLSTATE `23P01`) → "Khoảng hiệu lực bị chồng với v{n} ({khoảng}). Hãy chọn ngày khác hoặc đặt ngày kết thúc cho v{n}."
- **Tạo draft từ version**: nếu flow đã có draft → thông báo "Flow đang có bản nháp v{n}. Hãy publish hoặc hủy bản nháp đó trước." (không ghi đè).
- **Đổi `effective_to`** của version published: chỉ trường này được sửa (trigger cho phép); kiểm tra chồng lấn như publish.
- Mọi thao tác ghi `audit_logs` qua trigger sẵn có.

### 14.5 Thay đổi database cho bước 3

Đối chiếu với `supabase/migrations/` hiện có: trạng thái `draft/published/retired`, ràng buộc ngày, exclusion constraint, unique 1 draft, trigger bất biến và `admin_publish_flow_version` (import) **đã có**. Cần thêm **một file migration mới** (không sửa file cũ), VD `supabase/migrations/2026102700xxxx_designer_versions.sql`:

| Đối tượng | Mục đích |
|-----------|----------|
| `admin_create_flow(p_code, p_name, p_description, p_category, p_instructions, p_definition)` | Tạo flow mới + draft v1 trong một giao dịch (Designer "Tạo flow mới") |
| `admin_save_flow_draft(p_version_id, p_definition, p_expected_updated_at)` | Lưu draft có kiểm tra xung đột: chỉ cập nhật khi `updated_at = p_expected_updated_at`; nếu không → lỗi `HF002 draft_conflict`; trả `updated_at` mới |
| `admin_create_draft_from_version(p_version_id)` | Clone `definition` của một version thành draft mới (rollback/sửa tiếp); đã có draft → lỗi unique (`23505`) được map thành thông báo §14.4 |
| `admin_publish_flow_draft(p_version_id, p_effective_from, p_effective_to, p_change_note, p_close_previous, p_expected_updated_at)` | Publish draft: kiểm tra `change_note` không rỗng, xung đột `updated_at`, tùy chọn đóng version mở trước đó — cùng một giao dịch |
| `admin_publish_flow_version` (thay bằng `create or replace`, giữ chữ ký) | Bổ sung bắt buộc `change_note` không rỗng cho đường import |

- Tất cả là `SECURITY INVOKER`, kiểm tra `private.is_admin()` bên trong, `set search_path = ''`, `revoke` khỏi `public, anon`, `grant execute` cho `authenticated`; RLS hiện có vẫn áp dụng.
- Retire, đổi `effective_to`, hủy draft dùng UPDATE/DELETE trực tiếp qua PostgREST (RLS chỉ cho Admin, trigger kiểm soát) — không cần hàm mới.
- Không thêm CHECK `change_note` ở mức bảng vì version đã publish có thể đang có `change_note = ''` (kiểm tra ở các hàm publish).
- Vận hành: file migration mới không chứa `drop`/`delete` thì áp dụng bằng kết nối Supabase như bước 2; phần nào bắt buộc chứa `drop` hoặc `delete` phải gửi SQL để Harold dán vào SQL Editor (HANDOFF §3). Cập nhật `supabase/tests/rls.sql` cho các hàm mới (User gọi → `42501`).

---

## 15. Trải nghiệm người dùng

### 15.1 User — Run Wizard

1. **Chọn flow** (danh sách flow được gán, có tìm kiếm, nhóm theo category, mô tả + hướng dẫn do Admin viết).
2. **Nhập tham số** (kỳ, chi nhánh…). Hiển thị version sẽ được dùng theo effective date.
3. **Upload file** theo từng slot (kéo thả, có tải file mẫu nếu Admin cung cấp).
4. **Validation report** → sửa file rồi upload lại, hoặc chạy tiếp nếu chỉ có warning.
5. **Chạy** → progress theo node, có nút Cancel.
6. **Kết quả**: xem trước bảng/chart, **tải Excel**.
7. **Lịch sử chạy**: thời gian, flow, version, tham số, trạng thái (không có nội dung dữ liệu).

### 15.2 Admin

- **Dashboard**: số lượt chạy, tỉ lệ lỗi theo flow, flow sắp hết hiệu lực.
- **Users & Groups**: tạo, khóa, reset mật khẩu, gán group, import danh sách user từ Excel.
- **Flow Designer** (canvas, bước 3 — wireframe màn 5): mô tả chi tiết ở §15.3.
- **Ref Tables**: tạo/sửa bằng grid hoặc import từ Excel; quản lý version theo effective date.
- **Templates**: upload, xem danh sách sheet/named range.
- **Logs**: run log, audit log; lọc, xuất Excel.
- **Version & hiệu lực**: §14.4.

### 15.3 Flow Designer (bước 3)

Chỉ Admin; chỉ desktop (≥ 1280px). Route riêng, lazy-load (React Flow, code editor không nằm trong chunk của User). Designer luôn chỉnh **draft** của flow; version published/retired chỉ mở ở chế độ chỉ xem (có nút "Tạo draft từ version này").

**Bố cục**

- Bảng node bên trái: các node của bước 3 (§12), nhóm theo Input / Biến đổi / Kiểm soát / Code / Output, có tìm kiếm; kéo thả vào canvas hoặc nhấn Enter để thêm vào giữa canvas.
- Canvas ở giữa (React Flow): node theo design system (§25.3, vạch màu theo nhóm), hiển thị nhãn, loại node, số cột output; port vào/ra có tên. Nối dây bằng kéo từ port; không cho nối tạo vòng hoặc nối 2 dây vào cùng một input port.
- Panel cấu hình bên phải: form của node đang chọn; tab "Tham số" và "Input slot" khi không chọn node.
- Panel dữ liệu bên dưới (thu gọn được): file mẫu theo slot, tham số xem trước, kết quả xem trước (§13.3), validation report của file mẫu.

**Lưu (chốt 2026-10-26 22:52)**

- Không tự lưu. Lưu bằng nút **Lưu** hoặc **Ctrl+S** (Cmd+S trên macOS; chặn hộp "Save page" của trình duyệt). Nút Lưu hiển thị trạng thái "Đã lưu" / "Có thay đổi chưa lưu".
- Luôn lưu được, kể cả khi draft chưa có node nào hoặc còn lỗi; lỗi chỉ chặn ở bước Publish (chốt 2026-10-29).
- Draft được lưu kể cả khi flow còn lỗi kiểm tra (lỗi chỉ chặn publish), nhưng JSON phải parse được theo `FlowDefinitionSchema` ở mức cấu trúc.
- **Cảnh báo rời trang** khi có thay đổi chưa lưu: chuyển route trong app → dialog "Rời trang / Ở lại"; đóng tab/tải lại → `beforeunload` của trình duyệt. Ngoại lệ: tự đăng xuất do không thao tác (§6.1).
- **Kiểm tra xung đột** theo `updated_at`: khi lưu gửi `updated_at` đã tải; nếu draft đã được lưu bởi phiên khác (`HF002 draft_conflict`) → dialog "Bản nháp vừa được lưu ở nơi khác lúc {giờ}." với lựa chọn: "Tải bản mới nhất" (bỏ thay đổi của mình), "Xuất JSON thay đổi của tôi" (để không mất công) — không có lựa chọn ghi đè.

**Form cấu hình**

- Mỗi node có form riêng sinh từ cấu hình §12.1: chọn cột bằng dropdown từ schema suy diễn (§13.2), không gõ tay tên cột; SQL editor (Monaco, §5) có highlight + autocomplete tên view/cột/tham số.
- **Input slot**: form đầy đủ **mọi trường** của `InputSlotSchema` (`packages/flow-schema/src/input-slot.ts`), Admin không phải sửa JSON (chốt 2026-10-26 22:52): `key`, `label`, `required`, `accept` (.xlsx/.xls), `sheet` (byName / byIndex / firstMatchingHeaders), `headerRow`, `headerRows`, `dataStartRow`, `stopAt.blankRows`, `skipRows` (`whenBlank`, `whenKeyContains`), `unmergeCells`, `extraColumns`, `multiple` (`enabled`, `minFiles`, `maxFiles`), `maxRows`; bảng cột với từng cột: `key`, `label`, `aliases` (nhiều giá trị), `type`, `presence`, `required`, `defaultValue` (theo kiểu), `rules` (`unique`, `regex`, `min`, `max`, mỗi rule có `severity`), `dateFormats`, `decimalSeparator`. Form tuân theo các ràng buộc chéo của schema (VD `defaultValue` chỉ hiện khi `required = false`; `dataStartRow` phải sau dòng header; `minFiles ≤ maxFiles`; key không bắt đầu bằng `_`).
- **Tham số**: form cho `params`: `key`, `label`, `type`, `required`, `log` (mặc định theo kiểu, giải thích rõ khi nào bị ghi log), `isAsOfDate` (tối đa 1 tham số), `options` (danh sách value/label cho `select`; `fromRefTable` để Phase 2).
- Đổi `key` của slot/tham số/cột mà node khác đang dùng → cảnh báo và liệt kê node bị ảnh hưởng (không tự đổi theo).

**Kiểm tra realtime**

- Sau mỗi thay đổi (debounce ~300 ms) chạy kiểm tra của engine trong worker: schema flow, DAG, port bắt buộc chưa nối, cấu hình node, schema suy diễn.
- Node lỗi: **viền coral** + biểu tượng; hover/focus hiện **tooltip** nội dung lỗi; trường lỗi trong form viền coral kèm thông báo. Cảnh báo (không chặn) dùng amber. Thanh trạng thái hiển thị tổng số lỗi/cảnh báo, bấm để nhảy tới node.

**Thao tác canvas**

- **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y): mọi thay đổi trên canvas và form, tối thiểu 100 bước, xóa khi tải lại draft.
- **Copy/paste** node (Ctrl+C / Ctrl+V, nhiều node cùng lúc, giữ dây nối nội bộ giữa các node được chọn; id mới tự sinh; nhân bản cả `ui.positions`). Clipboard chỉ trong app (không chứa dữ liệu nhân sự vì chỉ là cấu hình).
- Xóa node/dây bằng Delete/Backspace (có undo).
- **Auto-layout** (thuật toán layered tự viết, trái → phải, không chồng node), có undo.
- **Minimap**, zoom, fit view.
- **Sticky note**: thêm/sửa/xóa ghi chú văn bản trên canvas, lưu trong `ui.notes`.
- **Export JSON**: tải `definition` hiện tại (kể cả chưa lưu) thành file `.json`; **Import JSON** giữ luồng đã có ở màn Flow của Admin (§8.1).
- Bàn phím: mọi hành động chính có phím tắt và nút tương ứng; node chọn được bằng Tab. Ngoại lệ ở bước 3: nối cạnh giữa các cổng chỉ làm bằng chuột (React Flow không hỗ trợ bàn phím); cách nối bằng bàn phím (chọn cổng nguồn → chọn cổng đích trong menu) làm ở R4 nếu còn hạn mức (chốt 2026-10-29).

---

## 16. Vận hành trên free tier

| Rủi ro | Giải pháp |
|--------|-----------|
| Supabase pause sau 7 ngày không hoạt động | GitHub Actions theo lịch ping 1 truy vấn nhẹ mỗi ngày; Admin dashboard cảnh báo nếu ping thất bại |
| Free tier không có backup tự động đầy đủ | GitHub Actions hằng tuần chạy `pg_dump` cấu hình (không chứa dữ liệu cá nhân) → lưu vào artifact private / Google Drive của HR; Export flow JSON định kỳ |
| Giới hạn DB 500MB / Storage 1GB | Run log tự xóa sau 12 tháng (cấu hình được); ref table lớn lưu dạng Parquet trong Storage |
| Pyodide/DuckDB tải chậm lần đầu | DuckDB: Cache Storage trong worker, chỉ tải khi flow cần (§13.1). Pyodide (Phase 2): cơ chế cache tương tự |
| Giới hạn 25 MiB/file của Cloudflare Pages | File `.wasm` của DuckDB tách thành phần < 25 MiB lúc build, ghép lại trong worker (§13.1) |
| Monaco làm nặng bundle | Chỉ nằm trong chunk Designer (lazy-load khi Admin mở Designer); không vào entry chunk hay chunk của User; build kiểm tra ngân sách kích thước (§18) |

---

## 17. Bảo mật & tuân thủ

- **Dữ liệu cá nhân không lưu trên server**: file Excel chỉ nằm trong bộ nhớ trình duyệt; đóng tab là mất. Không dùng IndexedDB/localStorage/Cache Storage để lưu file; file mẫu của Designer cũng chỉ nằm trong RAM (chốt 2026-10-26 22:52).
- **Bảng tham chiếu** chỉ chứa dữ liệu **không mang tính cá nhân** (danh mục, mapping mã, biểu thuế, hệ số). Khi import, hệ thống cảnh báo nếu phát hiện cột có tên dạng `họ tên`, `CCCD`, `số điện thoại`, `email`, `mã NV`… (heuristic) và yêu cầu Admin xác nhận.
- **Run log** không chứa nội dung; tên file gốc được hash (SHA-256) thay vì lưu nguyên văn (tên file có thể chứa tên người).
- Tham chiếu pháp lý: Nghị định 13/2023/NĐ-CP; Luật Bảo vệ dữ liệu cá nhân 2025 (hiệu lực 01/01/2026). Thiết kế local-first giúp hạn chế tối đa việc xử lý/chuyển dữ liệu cá nhân ra nước ngoài. *(Cần bộ phận Pháp chế/IT của công ty xác nhận.)*
- HTTP security headers (cấu hình qua `apps/web/public/_headers` của Cloudflare Pages): CSP chặt (§9.5), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS.
- CSP (nguồn sự thật là `_headers`; tài liệu này và `.claude/rules/data-privacy.md` phải khớp):

| Directive | Giá trị | Lý do |
|-----------|---------|-------|
| `default-src` | `'self'` | |
| `script-src` | `'self' 'wasm-unsafe-eval'` | Cho phép biên dịch WebAssembly (DuckDB); **script inline vẫn bị chặn** |
| `worker-src` | `'self' blob:` | Engine worker, worker của DuckDB, editor worker của Monaco (same-origin) |
| `connect-src` | `'self'` + `https://<ref>.supabase.co` + `wss://<ref>.supabase.co` + **`blob:`** | `blob:` để DuckDB tải file `.wasm` đã ghép từ URL cục bộ (bước 3, chốt 2026-10-27 07:31); không có domain ngoài |
| `style-src` | `'self' 'unsafe-inline'` | React Flow, Monaco gán style lúc chạy (chốt 2026-10-27 07:31) |
| `font-src` | `'self'` | Be Vietnam Pro và font codicon của Monaco đều self-host |
| `img-src` | `'self' data: blob:` | |
| `object-src` / `base-uri` / `form-action` / `frame-ancestors` | `'none'` / `'self'` / `'self'` / `'none'` | |

  Bước 3 phải sửa `_headers`: thêm `blob:` vào `connect-src` (hiện chưa có). Mọi thay đổi khác của CSP phải được Harold đồng ý.
- Không log dữ liệu ra console ở bản production; không dùng dịch vụ analytics/tracking bên thứ ba.
- Supabase: tắt sign-up, bật RLS cho mọi bảng, chạy Supabase Security Advisor trước mỗi release.

---

## 18. Yêu cầu phi chức năng

| Hạng mục | Mục tiêu |
|----------|----------|
| Trình duyệt | Chrome, Edge (2 phiên bản mới nhất), desktop |
| Hiệu năng | 100k dòng × 30 cột, flow 15 node: < 10 giây (không có node Python) trên laptop 8GB RAM |
| UI | Tải trang đầu < 3 giây (chưa tính WASM engine); UI không bị treo khi engine chạy |
| Kích thước bundle | Entry chunk và chunk của User không chứa React Flow, Monaco, DuckDB; Monaco + React Flow chỉ trong chunk Designer. Ngân sách (chốt 2026-10-27): entry chunk (gzip) không tăng quá 10% so với cuối bước 2 (đo tại commit `d079f6b`, lưu mốc trong repo); script build tự kiểm tra và báo lỗi khi vượt |
| Khả dụng | Phụ thuộc SLA free tier; app vẫn mở được khi Supabase lỗi nhưng không đăng nhập được |
| Accessibility | WCAG 2.1 AA cho phần User |
| i18n | `vi` mặc định; mọi text UI qua i18next; định dạng số/ngày theo locale (`1.234.567,89` cho vi) |

---

## 19. Cấu trúc dự án

```
HR-System/
├─ apps/web/                      # React SPA
│  ├─ src/
│  │  ├─ app/                     # routes, layouts
│  │  ├─ features/
│  │  │  ├─ auth/
│  │  │  ├─ admin/                # users, groups, ref-tables, templates, logs
│  │  │  ├─ designer/             # canvas, node panels
│  │  │  └─ runner/               # run wizard, history
│  │  ├─ engine/                  # chạy trong worker
│  │  │  ├─ core/                 # planner, executor, types
│  │  │  ├─ nodes/                # mỗi node type là 1 plugin
│  │  │  ├─ duckdb/               # nạp WASM (ghép phần, checksum, cache), chuyển Arrow, biên dịch SQL
│  │  │  ├─ formula/              # Excel formula parser + transpiler → SQL (bước 4)
│  │  │  ├─ io/                   # excel reader/writer, template filler
│  │  │  └─ python/               # pyodide worker
│  │  ├─ lib/                     # supabase client, utils
│  │  └─ locales/{vi,en}/
│  └─ public/_headers             # CSP & security headers
├─ packages/flow-schema/          # Zod schema flow (dùng chung UI + engine + test)
├─ supabase/
│  ├─ migrations/                 # SQL schema + RLS
│  ├─ functions/admin-users/      # Edge Function
│  └─ seed.sql
├─ .github/workflows/keep-alive.yml # GitHub Actions ping Supabase hằng ngày
├─ e2e/                           # Playwright
├─ docs/
│  ├─ spec.md                     # đặc tả (file này)
│  └─ MEMORY.md                   # nhật ký quyết định
└─ CLAUDE.md                      # hướng dẫn cho Claude (phải nằm ở root)
```

Package manager: pnpm workspace.

---

## 20. Chiến lược kiểm thử

- **Unit (Vitest)**: từng node plugin, formula transpiler (golden test so với Excel), validator input slot, effective date resolver.
- **Engine integration**: chạy flow mẫu với file Excel mẫu (dữ liệu giả) → so sánh với output kỳ vọng.
- **RLS test**: chạy test SQL trên Supabase local (`supabase test db` / pgTAP) để đảm bảo User không đọc được flow chưa được gán.
- **E2E (Playwright)**: đăng nhập → chạy flow → tải file; Admin tạo flow → publish → User thấy flow.
- **DuckDB (bước 3)**: test node chạy được trong Node (Vitest, dùng DuckDB-WASM chạy trên Node, cùng phiên bản với bản trình duyệt) cùng bộ golden case với bản trình duyệt; test tương đương chuẩn hóa khóa TS ↔ SQL; E2E kiểm tra tải các phần `.wasm`, checksum và cache.
- **Performance test**: bộ dữ liệu giả 100k / 500k / 1M dòng.
- Dữ liệu test **luôn là dữ liệu giả** (Faker), không dùng dữ liệu thật của công ty.

---

## 21. Phạm vi MVP & Roadmap

### Phase 1 — MVP (mục tiêu: chạy được flow nghiệm thu **đối chiếu bảng lương – chấm công**)
- Auth (username/password, đổi mật khẩu lần đầu, khóa tài khoản), Users, Groups, gán flow.
Bước 1–2 đã xong (engine, Run Wizard, Supabase, Admin Users & Groups, import flow JSON, run log, deploy). Bước 3 (chốt 2026-10-26 22:52, cập nhật 2026-10-27 07:31):

- Flow Designer canvas (§15.3) với các node: `input.excel`, `control.compare`, `output.excel` (đã có) và `transform.select`, `transform.filter`, `transform.sort`, `transform.join`, `transform.union`, `transform.groupBy`, `transform.dedupe`, `code.sql` (mới, chạy bằng DuckDB-WASM, §12.1, §13.1), `output.preview` (mới, §12.1.10).
- Xem trước từng node bằng file mẫu chỉ trong RAM (§13.3); schema suy diễn từ input slot (§13.2).
- Màn Version & hiệu lực: Draft/Published/Retired, publish, retire, rollback, **diff version** (§14.3, §14.4).
- Export flow JSON từ Designer (import đã có từ bước 2).
- Tự đăng xuất sau 8 giờ không thao tác (§6.1).
- Xem trước kết quả trong app: màn Kết quả của Run Wizard hiển thị các sheet của `output.excel` và các bảng của `output.preview` (tab "Chỉ xem").

Toàn bộ Phase 1:
- Auth (username/password, đổi mật khẩu lần đầu, khóa tài khoản), Users, Groups, gán flow.
- Input slot (hỗ trợ nhiều file / slot) + validation report.
- Flow nghiệm thu §24 chạy đúng với bộ dữ liệu giả `fixtures/payroll-timesheet/`.
- Draft/Published + effective date cho flow, diff version.
- Run Wizard + run log.
- Deploy Cloudflare Pages + Supabase + keep-alive.

**Bước 4** (ngay sau bước 3, chốt 2026-10-27 07:31; chi tiết chốt 2026-10-30 13:18): `transform.formula` — công thức Excel transpile sang SQL DuckDB (§9.1, §12.2), dùng DuckDB runtime của bước 3. User story + AC: §27. Vòng code đầu gộp HANDOFF §4 mục #1 (giới hạn giải nén .xlsx).

Không thuộc Phase 1: `input.refTable`, bảng tham chiếu, template — Phase 2.

### Phase 2 — Mở rộng xử lý & báo cáo
- `code.python` (Pyodide). `transform.formula` không có chế độ Python (chốt 2026-10-30 13:18).
- `output.template` (template Excel, bảng `templates`), `output.chart`.
- Bảng tham chiếu (`ref_tables`, `ref_table_versions`) có effective date, import từ Excel, node `input.refTable` (chốt 2026-10-26 22:52).
- `control.assert`, `pivot/unpivot`, `window`, `lookup`, `fillDown`, `cast`, `split/merge`, `sample/limit`.

### Phase 3 — Nâng cao
- `subflow` (tái sử dụng), `control.branch`.
- Admin dashboard thống kê.
- i18n tiếng Anh.
- (Tùy chọn) TOTP 2FA, SSO Microsoft Entra ID, chuyển sang Supabase self-host.

---

## 22. Câu hỏi mở

| # | Câu hỏi | Ảnh hưởng |
|---|---------|-----------|
| ~~Q1~~ | ~~Flow nghiệm thu MVP?~~ → Đã chốt 2026-10-26: đối chiếu bảng lương – chấm công | — |
| Q2 | IT/Pháp chế công ty có yêu cầu gì khi dùng cloud nước ngoài cho metadata không? | Hosting |
| Q3 | Số lượng user dự kiến? | Free tier (Supabase Free: 50k MAU — dư) |
| Q4 | Có cần Admin "giả lập" (impersonate) quyền User để kiểm tra không? | Phân quyền |
| ~~Q5~~ | Đã chốt 2026-10-26: `sessionStorage` | — |
| ~~Q6~~ | Đã chốt 2026-10-26: Admin thấy/chạy mọi flow đã publish | — |
| ~~Q7~~ | Đã chốt 2026-10-26: tự đăng xuất sau 8 giờ không thao tác, làm phía client ở bước 3; chi tiết chốt 2026-10-26 22:52 (§6.1) | — |
| ~~—~~ | Đã chốt 2026-10-26 22:52: phạm vi node bước 3, DuckDB-WASM tự host, draft lưu bằng nút Lưu, xem trước bằng file mẫu trong RAM, bảng tham chiếu sang Phase 2, diff version trong bước 3 | — |
| ~~Q8~~ | Đã chốt 2026-10-27: file `.wasm` đã ghép cấp cho DuckDB qua URL `blob:` cục bộ; CSP `connect-src` thêm `blob:` (§13.1, §17) | — |
| ~~Q9~~ | Đã chốt 2026-10-27: `transform.formula` làm ở bước 4, ngay sau bước 3 (§21) | — |
| ~~Q10~~ | Đã chốt 2026-10-27: `normalizeKeys` (join, dedupe) và `normalizeText` (filter) mặc định bật, Admin tắt được (§12.1) | — |
| ~~Q11~~ | Đã chốt 2026-10-27: `transform.sort` sắp chữ theo bảng chữ cái tiếng Việt (`Intl.Collator('vi')`) (§12.1.3) | — |
| ~~Q12~~ | Đã chốt 2026-10-27: dùng Monaco, chỉ trong chunk Designer, worker và font self-host, không dùng CDN loader (§5) | — |
| ~~Q13~~ | Đã chốt 2026-10-27: node `output.preview` có trong bước 3 (§12.1.10) | — |
| ~~Q14~~ | Đã chốt 2026-10-27: cột thêm của slot `extraColumns: 'keep'` chỉ dùng được trong `code.sql` lúc chạy, Designer cảnh báo (§12.1.9) | — |
| ~~Q18~~ | Đã chốt 2026-10-30 13:29: canvas Designer, Monaco và bảng xem trước giữ chữ 14px (§25.1) | — |
| ~~Q17~~ | Đã chốt 2026-10-30 13:24: công thức dùng `,` ngăn đối số và `.` thập phân, không nhận `;` (§12.2) | — |
| ~~Q16~~ | Đã chốt 2026-10-30 13:18: `transform.formula` chỉ nhận công thức Excel (transpile sang SQL), 41 hàm, không có XLOOKUP/VLOOKUP (§9.1, §12.2) | — |
| ~~Q15~~ | Đã chốt 2026-10-27: CSP giữ `style-src 'self' 'unsafe-inline'` (React Flow, Monaco gán style lúc chạy), script inline vẫn bị chặn; quy tắc `data-privacy.md` sửa cho khớp (§17) | — |

---

## 23. Thuật ngữ

| Thuật ngữ | Giải thích |
|-----------|-----------|
| Flow | Chuỗi các bước xử lý dữ liệu, được Admin cấu hình |
| Node | Một bước xử lý trong flow |
| Input slot | Một "ô" chờ User upload file, kèm quy tắc đọc & validate |
| Ref table | Bảng tham chiếu lưu trên server (danh mục, biểu thuế…) |
| Effective date | Khoảng thời gian một version có hiệu lực |
| As-of date | Ngày dùng để chọn version khi chạy |
| DuckDB-WASM | Cơ sở dữ liệu phân tích chạy trong trình duyệt |
| Pyodide | Python chạy trong trình duyệt |
| RLS | Row Level Security — phân quyền theo dòng trong Postgres |

---

## 24. Flow nghiệm thu MVP: Đối chiếu bảng lương – chấm công

### 24.1 Mô tả

Hằng tháng, HR đối chiếu dữ liệu công trên **bảng lương** với **dữ liệu chấm công** của từng chi nhánh để phát hiện sai lệch trước khi chốt lương.

| Hạng mục | Nội dung |
|----------|----------|
| Đầu vào 1 | Slot `bang_luong`: nhiều file (1 file / chi nhánh), sheet `Luong`, có dòng tiêu đề merge, header ở dòng 4, có dòng "TỔNG CỘNG" cuối bảng |
| Đầu vào 2 | Slot `cham_cong`: nhiều file (1 file / chi nhánh), tổng hợp theo tháng, mỗi NV 1 dòng, header ở dòng 1 |
| Tham số | `ky_luong` (tháng, bắt buộc, là as-of date) |
| Khóa | `ma_nv` (đồng nhất giữa 2 hệ thống) |
| Chỉ tiêu | Ngày công, giờ OT, ngày phép, ngày nghỉ không lương |
| Ngưỡng mặc định | Công ±0.5 · OT ±1 giờ · Phép 0 · Không lương 0 (Admin cấu hình được) |

Mapping cột (alias):

| key | Bảng lương | Chấm công | Kiểu |
|-----|------------|-----------|------|
| `ma_nv` | Mã NV, MSNV | Mã nhân viên | string, bắt buộc, unique |
| `ho_ten` | Họ và tên | Họ tên | string |
| `chi_nhanh` | Chi nhánh | Chi nhánh | string |
| `cong` | Công tính lương | Công thực tế | decimal |
| `ot` | Giờ OT | OT (giờ) | decimal |
| `phep` | Ngày phép | Phép (ngày) | decimal |
| `khong_luong` | Nghỉ không lương | Không lương (ngày) | decimal |

Flow (DAG):

```
[input.excel bang_luong] ─┐
                          ├─► [control.compare key=ma_nv, metrics+tolerance] ─┬─► sheet "Tổng hợp"
[input.excel cham_cong] ──┘                                                   ├─► sheet "Lệch"
                                                                              ├─► sheet "Chỉ có trong lương"
                                                                              └─► sheet "Chỉ có trong chấm công"
                                                                                   ▼
                                                                           [output.excel]
```

### 24.2 Node `control.compare` (MVP)

- **Input**: 2 bảng `left`, `right`. **Config**: `keys[]`, `metrics[]` = `{ left, right, label, tolerance }`, `carryColumns[]` (cột mang theo để hiển thị, VD `ho_ten`, `chi_nhanh`).
- **Output (4 port)**:
  - `summary`: 1 dòng / chỉ tiêu + dòng tổng — số NV khớp, lệch, chỉ có ở A, chỉ có ở B, tổng chênh lệch.
  - `mismatched`: 1 dòng / NV lệch; mỗi chỉ tiêu có 3 cột `<label> (lương)`, `<label> (chấm công)`, `<label> (chênh lệch)` với chênh lệch = right − left; thêm cột `Chỉ tiêu lệch` (liệt kê).
  - `only_left`, `only_right`: các dòng không tìm thấy khóa ở bảng còn lại.
- Quy tắc so sánh: `|right − left| > tolerance` ⇒ lệch. Giá trị null được coi là 0 nếu Admin bật `nullAsZero` (mặc định bật), ngược lại null ≠ số bất kỳ ⇒ lệch.
- So khớp khóa không phân biệt hoa thường, bỏ khoảng trắng thừa (chốt 2026-10-26).
- Rule `unique` của input slot dùng cùng cách chuẩn hóa khóa này, để trùng mã bị phát hiện ngay ở bước kiểm tra file (chốt 2026-10-26).
- Sheet "Lệch": giá trị null hiển thị ô trống, nhưng vẫn tính là 0 khi so sánh nếu `nullAsZero` bật (chốt 2026-10-26).
- Tính toán bằng decimal, không dùng float.

### 24.3 User story & Acceptance criteria

**US-01** — Là HR (User), tôi muốn upload bảng lương và chấm công của nhiều chi nhánh rồi nhận file đối chiếu, để phát hiện sai lệch trước khi chốt lương.

| # | Given / When / Then |
|---|---------------------|
| AC-01 | **Given** flow đã được publish và gán cho tôi, **when** tôi chọn kỳ 09/2026 và upload 3 file lương + 3 file chấm công trong bộ fixture, **then** validation report không có lỗi và flow cho phép chạy. |
| AC-02 | **Given** file lương CN02 dùng header "MSNV", **when** hệ thống đọc file, **then** cột được nhận là `ma_nv` (khớp theo alias). |
| AC-03 | **Given** file lương có dòng tiêu đề merge và dòng "TỔNG CỘNG", **when** đọc file, **then** chỉ các dòng nhân viên được lấy (75 dòng lương, 75 dòng chấm công). |
| AC-04 | **When** chạy xong, **then** kết quả khớp `fixtures/payroll-timesheet/expected.json`: 63 khớp, 9 lệch, 3 chỉ có trong lương, 3 chỉ có trong chấm công. |
| AC-05 | **Given** một NV có công lệch 0.5 và ngưỡng công là 0.5, **then** NV đó được tính là **khớp**. |
| AC-06 | **When** tải kết quả, **then** nhận 1 file .xlsx với 4 sheet đúng tên: "Tổng hợp", "Lệch", "Chỉ có trong lương", "Chỉ có trong chấm công"; header in đậm, freeze dòng đầu, có auto-filter. |
| AC-07 | **Given** 2 file upload cùng chứa một mã NV, **when** validate, **then** báo lỗi "Mã NV trùng" kèm tên file và số dòng của cả hai, và không cho chạy. |
| AC-08 | **Given** một file thiếu cột bắt buộc (VD không có cột mã NV), **when** validate, **then** báo lỗi chỉ rõ file và cột thiếu. |
| AC-09 | **When** chạy flow, **then** không có request mạng nào chứa nội dung file; `run_logs` chỉ ghi kỳ, số file, số dòng, hash tên file, trạng thái, thời gian. |
| AC-10 | **Given** Admin đổi ngưỡng OT thành 5 giờ và publish version mới, **when** chạy lại kỳ có hiệu lực của version mới, **then** NV lệch OT 4 giờ được tính là khớp. |

**US-02** — Là Admin, tôi muốn dựng flow đối chiếu trên canvas bằng các node `input.excel`, `control.compare`, `output.excel`, để không cần dev khi đổi ngưỡng hoặc thêm chỉ tiêu.

| # | Given / When / Then |
|---|---------------------|
| AC-11 | Admin cấu hình được 2 input slot (nhiều file), node compare (khóa, chỉ tiêu, ngưỡng) và output 4 sheet hoàn toàn qua UI. |
| AC-12 | Khi chọn file mẫu cục bộ, Admin xem được preview từng port output của node compare ngay trên Designer. |
| AC-13 | Flow không publish được nếu thiếu effective_from, còn port bắt buộc chưa nối, hoặc khóa/chỉ tiêu tham chiếu tới cột không tồn tại. |

AC-11 … AC-13 được chi tiết hóa ở §26 (AC-B3-33, AC-B3-53, AC-B3-61, AC-B3-62).

### 24.4 Dữ liệu kiểm thử

`fixtures/payroll-timesheet/` — dữ liệu **giả** sinh bằng `generate.py` (seed cố định):
- 3 chi nhánh (CN01 30 NV, CN02 25 NV, CN03 20 NV) × 2 loại file.
- Sai lệch có chủ đích mỗi chi nhánh: 1 lệch công trong ngưỡng, 1 lệch công vượt ngưỡng, 1 lệch OT, 1 lệch phép + công, 1 NV chỉ có trong lương, 1 NV chỉ có trong chấm công.
- `expected.json` — kết quả kỳ vọng để tester so sánh.

---

## 25. Design system (UI)

Toàn bộ UI dùng **một** design language ("bright executive" **bản 2**, chốt 2026-10-30 13:26), áp dụng như nhau cho phần User và Admin. Bản 2 giữ nguyên bộ màu và font của bản 1, đổi sang phong cách **phẳng**: bo góc vừa (12px), viền mảnh thay cho shadow, nút 3 cấp, eyebrow chữ in hoa không nền, thang chữ lớn. Wireframe cũ (bản 1, chỉ tham khảo bố cục): https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW.

### 25.1 Typography

Font duy nhất `Be Vietnam Pro` (400–700), fallback `Arial, sans-serif`, **self-host** (woff2, subset Latin + Vietnamese), không gọi Google Fonts (chốt 2026-10-26). Tiêu đề dùng weight 600 (không 700/800). Chữ in hoa chỉ dùng cho eyebrow; tiêu đề viết hoa đầu câu.

| Token | Desktop (≥ 768px) | Mobile (< 768px) | Dùng cho |
|-------|-------------------|------------------|----------|
| `display-xl` | 56px / 600 / lh 60px | 36px / lh 40px | Số KPI lớn |
| `display-lg` | 48px / 600 / lh 52px / ls −0.5px | 32px / lh 36px | Tiêu đề trang; viết như một câu kết luận ("Kỳ 09/2026 có 9 nhân viên lệch công cần xử lý") |
| `title-md` | 24px / 600 / lh 30px / ls −0.6px | 20px / lh 26px | Tiêu đề section, tiêu đề card |
| `title-sm` | 20px / 600 / lh 26px / ls −0.3px | 18px | Tiêu đề nhỏ trong card, tiêu đề dialog |
| `body-lg` | 18px / 400 / lh 27px | 16px / lh 24px | Đoạn dẫn, mô tả dưới tiêu đề trang, chữ trong input |
| `body` | 16px / 400 / lh 24px | 16px | Chữ mặc định, ô dữ liệu trong bảng |
| `label` | 16px / 600 / lh 24px | 16px | Nhãn form, chữ in đậm trong câu |
| `caption` | 14px / 400 / lh 21px | 14px | Chú thích, header bảng (600), thông tin phụ |
| `eyebrow` | 14px / 600 / lh 14px / ls 1px / UPPERCASE | 13px | Eyebrow trên tiêu đề, tiêu đề nhóm trong Select |
| `button` | 18px / 600 / lh 24px | 16px | Nhãn nút chuẩn |
| `button-sm` | 14px / 700 / ls 0.15px | 14px | Nút nhỏ (trong bảng, toolbar) |
| `code` | font mono hệ thống, 14px | 14px | Monaco, ô công thức, SQL |

**Ngoại lệ mật độ cao** (chốt 2026-10-30 13:29): canvas Designer (node, form cấu hình bên cạnh canvas), Monaco/ô công thức và bảng xem trước dữ liệu (xem trước node, màn Kết quả) dùng chữ 14px / lh 20px, header bảng 13px 600, padding ô 8px 12px; tiêu đề và nút trong các vùng này vẫn theo thang chung.

### 25.2 Màu

| Vai trò | Fill | Text | Tint (nền nhạt) |
|---------|------|------|-----------------|
| Text | — | `#1F2A44` (đậm) · `#334155` (body) · `#475569` (phụ — không dùng xám nhạt hơn cho chữ) | — |
| Nền | `#F7FAF9` (trang) · `#FFFFFF` (card) · `#F1F5F9` (trung tính) | — | — |
| Teal — chính / tốt | `#14B8A6` (trang trí) · `#0F766E` (nút chính) | `#0F766E` | `#DDF5EF` / `#E3F8F3` |
| Coral — rủi ro / lỗi | `#F97362` | `#C2410C` | `#FFF1E7` |
| Amber — cảnh báo | `#FBBF24` | `#B45309` | `#FFF8E1` |
| Blue — thông tin / Admin | `#3B82F6` | `#1D4ED8` | `#EAF2FF` |
| Viền input | `#475569` (đạt 3:1 cho viền control, WCAG 1.4.11) | — | — |
| Viền nút outline | `#1F2A44` | — | — |
| Viền card / đường kẻ bảng | `#E2E8F0` | — | — |

- Chữ trắng chỉ đặt trên `#0F766E`, `#1F2A44` hoặc `#1D4ED8` (đạt WCAG AA). Không đặt chữ trắng trên `#14B8A6`.
- Trang đăng nhập: nền phẳng `#F7FAF9`, card đăng nhập có viền (chốt 2026-10-30 13:26; bỏ gradient và vòng tròn trang trí).

### 25.3 Component

Thang khoảng cách cơ sở 4px: `2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64` px. Bo góc: `6px` (input, chip vuông), `12px` (card, nút, popover, dialog, node), `999px` (pill: status chip, tab, badge). Độ nổi:

| Mức | Cách thể hiện | Dùng cho |
|-----|---------------|----------|
| 0 — Phẳng | Không viền, không shadow | Nền trang, band nội dung |
| 1 — Viền mảnh | Viền 1px `#E2E8F0`, không shadow | Card, bảng, node trên canvas |
| 2 — Nổi | Viền 1px `#E2E8F0` + shadow `0 8px 28px rgba(31,42,68,0.12)` | Chỉ lớp nổi trên nội dung: popover (Select, picker, menu), dialog, toast |

| Component | Quy cách |
|-----------|----------|
| Card | Nền trắng, radius 12px, padding 24px, viền 1px `#E2E8F0`, **không shadow** |
| Card tối (nhấn mạnh) | Nền `#1F2A44`, chữ trắng, radius 12px, padding 24px; tối đa 1 card tối mỗi màn (VD kết luận chính của màn Kết quả) |
| KPI card | Như card + vạch trên 4px theo ý nghĩa (teal khớp, coral lệch, amber cần xem); số dùng `display-xl` |
| Eyebrow | Trên mỗi tiêu đề trang; `eyebrow` (in hoa, giãn chữ 1px), **không nền**; màu chữ theo ý nghĩa (`#0F766E`, `#1D4ED8`, `#C2410C`, `#B45309`) |
| Status chip | `caption` 600, radius 999px, chữ màu trên nền tint |
| Nút chính | Cao 48px (nút nhỏ 36px), padding ngang 24px, radius 12px, nền `#0F766E`, chữ trắng `button`; mỗi vùng chỉ 1 nút chính |
| Nút tối | Như nút chính, nền `#1F2A44`, chữ trắng; cho hành động quan trọng thứ hai |
| Nút outline | Như nút chính, nền trắng, viền 1px `#1F2A44`, chữ `#1F2A44` |
| Nút chữ | Không viền, nền trong suốt, chữ `#1F2A44` `button-sm`, padding 8px 16px, radius 12px; hover nền `#F1F5F9` |
| Nút nguy hiểm | Như nút outline, viền và chữ `#C2410C` |
| Input / Select trigger / picker trigger | Cao 48px, radius 6px, viền 1px `#475569`, chữ `body-lg`; focus: viền `#0F766E` + ring 3px `#DDF5EF`; lỗi: viền `#C2410C` + thông báo `caption` |
| Tab | Dạng pill; tab đang chọn nền tint + chữ màu đậm |
| Menu trái | Item cao 44px, radius 6px; item đang chọn nền `#DDF5EF`, chữ `#0F766E` 600, **vạch trái 3px `#0F766E`** |
| Thanh trên (top bar) | Nền trắng, viền dưới 1px `#E2E8F0`, padding 12px 24px |
| Callout | Nền tint, radius 12px, không viền, mở đầu bằng nhãn in đậm (`An toàn dữ liệu:`, `Lưu ý:`, `Hợp lệ:`) |
| Bảng | Trong card; header nền `#F1F5F9`, chữ `caption` 600 `#475569`; ô `body`, padding 12px 16px; đường kẻ dòng `#E2E8F0`; dòng cần chú ý tô nền tint; ô chênh lệch tô coral tint |
| Dialog | Độ nổi mức 2, radius 12px, padding 24px; tiêu đề `title-sm`; nút đặt phải, nút chính ngoài cùng |
| Toast | Độ nổi mức 2, radius 12px, padding 12px 16px, chữ `body` |
| Node trên canvas | Card radius 12px, viền 1px `#E2E8F0`; vạch màu trên theo nhóm node (blue đầu vào, teal `#14B8A6` biến đổi, coral kiểm soát, `#475569` code, amber đầu ra); node đang chọn có ring teal; node lỗi viền coral `#F97362` 2px; sticky note nền amber tint `#FFF8E1` |
| Month/Date picker | Tự làm, không dùng picker mặc định của trình duyệt. Trigger giống input, hiển thị "Tháng 10/2026" / `dd/MM/yyyy`; popover radius 12px, độ nổi mức 2; lưới 12 tháng ("Th 1"…"Th 12") hoặc lịch tuần bắt đầu thứ Hai; ô chọn nền `#0F766E` chữ trắng; điều hướng bằng phím mũi tên, PageUp/PageDown đổi năm, Esc đóng (chốt 2026-10-26) |
| Select (dropdown) | Tự làm, không dùng `<select>` mặc định của trình duyệt ở mọi màn. Trigger giống input; popover radius 12px, độ nổi mức 2; hỗ trợ nhóm (tiêu đề nhóm dạng `eyebrow`, VD "Tài khoản" / "Nhóm"); mục đang chọn nền teal nhạt + dấu check, hover nền `#F1F5F9`; tìm kiếm khi > 8 mục; bàn phím: mũi tên, Enter, Esc, gõ ký tự để nhảy; ARIA listbox/combobox (chốt 2026-10-27) |
| Vùng kéo thả file | Viền đứt 2px `#99E0D2`, nền `#F3FBF8`, radius 12px |
| Trang đăng nhập | Nền phẳng `#F7FAF9`; card đăng nhập rộng tối đa 440px, viền 1px `#E2E8F0`, padding 32px |

Breakpoint: mobile < 768px (1 cột, menu trái thu thành nút mở), tablet 768–1023px, desktop ≥ 1024px. Nội dung trang rộng tối đa 1280px, căn giữa.

### 25.4 Giọng văn UI

- Xưng "bạn", câu ngắn, rõ hành động. Tiêu đề trang nói được kết luận chính.
- Định dạng số kiểu Việt Nam (`0,5`, `1.234.567`).
- Không dùng ký hiệu có thể thiếu trong font (≤ ≥ → × −) trong text UI; dùng chữ hoặc `-`.
- Touch target tối thiểu 44px (nút chuẩn 48px); tương phản chữ đạt WCAG AA.

---

## 26. Bước 3: Flow Designer, Version, tự đăng xuất — User story & Acceptance criteria

> Phạm vi theo quyết định 2026-10-26 22:52 và 2026-10-27 07:31 (Q8–Q15 đã chốt, §22). Dữ liệu kiểm thử luôn là dữ liệu giả.

### 26.1 (a) DuckDB runtime & nhóm transform

**US-B3-01** — Là Admin, tôi muốn các node transform và SQL chạy nhanh trên trình duyệt, để xử lý file tới ~1 triệu dòng mà dữ liệu không rời máy.

| # | Given / When / Then |
|---|---------------------|
| AC-B3-01 | **Given** bản build production, **when** liệt kê `dist/`, **then** mọi file `< 25 MiB`, có `duckdb-manifest.json` với SHA-256 từng phần và toàn bộ. |
| AC-B3-02 | **Given** cache trống, **when** chạy flow có node DuckDB, **then** worker tải đủ các phần từ cùng origin, ghép, kiểm tra checksum, khởi tạo DuckDB từ URL `blob:` cục bộ (thu hồi sau khi khởi tạo); không có request tới domain nào khác ngoài app và Supabase. |
| AC-B3-02b | **Given** bản build production, **then** `_headers` có `connect-src` gồm đúng `'self'`, Supabase (`https`, `wss`) và `blob:`; `style-src 'self' 'unsafe-inline'`; `script-src` không có `'unsafe-inline'`; nội dung CSP khớp bảng §17 (test đọc file `_headers`). |
| AC-B3-03 | **Given** đã tải một lần, **when** tải lại trang và chạy lại, **then** không tải lại các phần `.wasm` (lấy từ Cache Storage). |
| AC-B3-04 | **Given** một phần `.wasm` bị sai checksum, **when** khởi tạo, **then** xóa cache, tải lại 1 lần; vẫn sai thì báo `duckdb.error.loadFailed` và không chạy flow. |
| AC-B3-05 | **Given** flow nghiệm thu (chỉ `input.excel`, `control.compare`, `output.excel`) hoặc flow chỉ thêm `output.preview`, **when** chạy, **then** không tải DuckDB và kết quả vẫn khớp `expected.json`. |
| AC-B3-06 | **When** DuckDB khởi tạo, **then** `enable_external_access = false`, không autoload/autoinstall extension, cấu hình bị khóa; `code.sql` gọi `read_csv('https://…')` hoặc `INSTALL httpfs` → lỗi `sql.error.forbidden`, không có request mạng. |
| AC-B3-07 | **Given** cột `decimal` có giá trị `0.1`, `0.2`, `1234567890123.25`, **when** đi qua `select` → `groupBy sum`, **then** tổng đúng chính xác (`1234567890123.55`), không có sai số float. |
| AC-B3-08 | **Given** cột `string` "00123" và cột `date` 2026-09-01, **when** đi qua chuỗi node DuckDB và quay về TS, **then** giữ nguyên "00123" và "2026-09-01". |
| AC-B3-09 | `select`: chọn/đổi tên/sắp lại cột đúng thứ tự cấu hình; chọn cột không tồn tại → `select.error.unknownColumn` trên đúng node; 2 cột output trùng key → `select.error.duplicateKey`. |
| AC-B3-10 | `filter`: `match = all` với 2 điều kiện cho đúng giao; `any` cho đúng hợp; ô trống chỉ thỏa `isBlank/neq/notIn/notContains`; điều kiện dùng tham số để trống bị bỏ qua; `contains` trên cột `decimal` → `filter.error.opNotForType`; giá trị "abc" cho cột `date` → `filter.error.invalidValue`. |
| AC-B3-11 | `filter` mặc định (`normalizeText` không khai báo → `true`): điều kiện `eq "cn01"` giữ dòng "CN01 " và "cn01"; Admin tắt `normalizeText` → chỉ giữ "cn01". |
| AC-B3-12 | `sort`: nhiều cột, asc/desc, ô trống cuối theo mặc định; dòng bằng nhau giữ thứ tự cũ; cột `string` theo bảng chữ cái tiếng Việt: "Đặng" xếp sau "Dương" và trước "Em", "an" và "An" coi như bằng nhau (giữ thứ tự cũ). |
| AC-B3-13 | `join` inner/left/right/full/anti cho đúng số dòng trên bộ fixture nhỏ có khóa chỉ bên trái, chỉ bên phải, trùng nhiều–nhiều; thứ tự dòng theo §12.1.4. |
| AC-B3-14 | `join` mặc định (`normalizeKeys` không khai báo → `true`): "NV001" khớp " nv001" và "NV001 " (NBSP); ô khóa trống không khớp với nhau. Kết quả chuẩn hóa SQL trùng `normalizeKeyPart` trên bộ golden test. Admin tắt `normalizeKeys` → chỉ khớp chính xác. |
| AC-B3-15 | `join` khóa `string` với khóa `decimal` → `join.error.keyTypeMismatch`; cột right trùng tên → đổi thành `<key>_r`; một khóa trái khớp 3 dòng phải → cảnh báo `join.warning.rowsMultiplied`, không chứa giá trị khóa. |
| AC-B3-16 | `union` 3 đầu vào: cột theo thứ tự `in_1` rồi cột mới; cột thiếu để trống (`missingColumns = 'null'`) hoặc lỗi `union.error.missingColumn` (`'error'`); `integer` + `decimal` → `decimal`; `string` + `date` → `union.error.typeMismatch`; `sourceColumn` ghi đúng nhãn từng dòng. |
| AC-B3-17 | `groupBy`: theo `chi_nhanh` cho sum/avg/min/max/count/countDistinct/countRows đúng trên fixture; `sum` toàn ô trống = 0; `avg` = SUM/COUNT làm tròn half-up 10 chữ số; `by` rỗng với 0 dòng đầu vào → 1 dòng (sum 0, count 0); `sum` trên cột `string` → `groupBy.error.fnNotForType`. |
| AC-B3-18 | `dedupe`: `keep = first/last` đúng; `removed` chứa đúng các dòng bị loại; dòng toàn khóa trống không bị loại; "NV001" và "nv001 " là trùng ở cấu hình mặc định, không trùng khi Admin tắt `normalizeKeys`. |
| AC-B3-19 | `code.sql` 2 input port `luong`, `cham_cong`: `SELECT … FROM luong JOIN cham_cong …` chạy đúng; schema output suy ra bằng `DESCRIBE` khớp kết quả chạy thật. |
| AC-B3-20 | `code.sql` từ chối: 2 câu lệnh (`sql.error.multipleStatements`), `CREATE TABLE`/`COPY`/`ATTACH`/`PRAGMA`/`SET` (`sql.error.notSelect` hoặc `sql.error.forbidden`), `$khong_co` (`sql.error.unknownParam`), cột kết quả tên "Họ tên" (`sql.error.invalidColumnName`), cột kiểu `LIST` (`sql.error.unsupportedType`). |
| AC-B3-21 | `code.sql` dùng `$chi_nhanh` với giá trị User nhập `x' OR 1=1 --` → giá trị được bind nguyên văn (lọc ra 0 dòng), không thay đổi câu lệnh. |
| AC-B3-22 | `code.sql` lỗi runtime (VD `CAST('abc' AS INTEGER)`): UI hiện thông báo DuckDB rút gọn ≤ 500 ký tự gắn đúng node; `run_logs.error_code = 'sql.error.runtime'`, không có text gốc; console không in thông báo này ở bản production. |
| AC-B3-23 | Kết quả `DOUBLE` từ `code.sql` (VD `x / 3`) được nhận về `decimal` theo 15 chữ số có nghĩa; Designer hiện cảnh báo khuyên `CAST`. |
| AC-B3-24 | Hiệu năng: flow `input.excel` (100k dòng × 30 cột) → `filter` → `join` → `groupBy` → `output.excel` chạy < 10 giây trên laptop 8 GB (không tính lần tải DuckDB đầu tiên); 1 triệu dòng × 30 cột (filter → join → groupBy → output.excel) chạy xong, không crash tab, đo trên Chromium thật. |
| AC-B3-25 | Bấm Hủy khi đang chạy node DuckDB → worker bị terminate, trạng thái "Đã hủy", có thể chạy lại sau khi kiểm tra lại file. |
| AC-B3-26 | Slot có `extraColumns: 'keep'`: Designer hiện cảnh báo trên node `input.excel` của slot; dropdown cột của node transform không có cột thêm; `code.sql` tham chiếu cột thêm chạy được lúc chạy khi file có cột đó, và báo `sql.error.runtime` gắn đúng node khi file không có. |

**US-B3-06** — Là User, tôi muốn xem các bảng kết quả mà Admin cấu hình để xem ngay trong app, để kiểm tra nhanh mà không cần tải file.

| # | Given / When / Then |
|---|---------------------|
| AC-B3-27 | **Given** flow có `output.excel` (2 sheet) và 2 node `output.preview` ("Theo chi nhánh", "Top lệch"), **when** chạy xong, **then** màn Kết quả có 4 tab theo thứ tự node trong flow, 2 tab preview có nhãn "Chỉ xem"; file tải về chỉ có 2 sheet của `output.excel`. |
| AC-B3-28 | Tab preview chỉ hiện các cột trong `columns` theo đúng thứ tự (không khai báo → mọi cột); sort theo cột và tìm kiếm hoạt động; bảng 100.000 dòng cuộn mượt (virtualized, main thread chỉ nhận từng trang). |
| AC-B3-29 | Bảng 250.000 dòng với `maxRows = 100.000` → chỉ giữ 100.000 dòng đầu và hiện callout "Đang hiển thị 100.000 / 250.000 dòng đầu."; `run_logs` chỉ có số dòng. |
| AC-B3-29b | Flow chỉ có `output.preview` → màn Kết quả không có nút tải file; không có artifact nào được tạo; không có request mạng chứa nội dung bảng; không có gì ghi vào localStorage/IndexedDB. |
| AC-B3-29c | `title` trùng với title của `output.preview` khác hoặc với tên sheet của `output.excel` (không phân biệt hoa thường) → `preview.error.duplicateTitle`; cột trong `columns` không tồn tại → `preview.error.unknownColumn`; cả hai chặn publish. |
| AC-B3-29d | Chạy lần mới, đổi flow, đóng tab hoặc tự đăng xuất → bảng preview của lần trước bị giải phóng; trước đó nút "Xem kết quả" mở lại được các tab preview. |

### 26.2 (b) Designer: canvas & form

**US-B3-02** — Là Admin, tôi muốn dựng và sửa flow bằng canvas kéo thả cùng form cấu hình đầy đủ, để tạo flow mới mà không phải sửa JSON.

| # | Given / When / Then |
|---|---------------------|
| AC-B3-30 | **Given** User thường, **when** truy cập URL Designer/Version, **then** bị chuyển hướng như các route Admin khác và không tải chunk Designer. |
| AC-B3-31 | Admin tạo flow mới (mã, tên, mô tả, nhóm, hướng dẫn) → tạo flow + draft v1 trong một thao tác; mã trùng → báo lỗi rõ ràng. |
| AC-B3-32 | Kéo node từ bảng bên trái vào canvas, nối port, xóa node/dây; không nối được dây tạo vòng, không nối 2 dây vào cùng input port (có thông báo). |
| AC-B3-33 | Dựng lại flow nghiệm thu §24 hoàn toàn qua UI (2 slot nhiều file, compare với khóa/chỉ tiêu/ngưỡng, output 4 sheet), lưu, publish; User chạy cho kết quả khớp `expected.json` (thay AC-11). |
| AC-B3-34 | Form input slot có đủ mọi trường của `InputSlotSchema` (§15.3); mỗi trường đổi trên form phản ánh đúng vào JSON đã lưu; ràng buộc chéo hiển thị lỗi ngay (VD `dataStartRow` trước dòng header, `minFiles > maxFiles`, `defaultValue` sai kiểu, regex không biên dịch, key bắt đầu bằng `_`). |
| AC-B3-35 | Form tham số: tạo `month` bắt buộc làm as-of date; đánh dấu `isAsOfDate` cho tham số thứ hai → báo lỗi; `select` nhập danh sách lựa chọn. |
| AC-B3-36 | Dropdown chọn cột trong form node chỉ liệt kê cột của schema suy diễn từ node phía trước (không cần file mẫu); đổi cột của slot → dropdown cập nhật trong ≤ 1 giây. |
| AC-B3-37 | Đổi `key` của cột slot đang được compare dùng → node compare viền coral, tooltip nêu cột không tồn tại; cảnh báo liệt kê node bị ảnh hưởng. |
| AC-B3-38 | Kiểm tra realtime: node lỗi viền coral + tooltip (hover và focus bàn phím); thanh trạng thái đếm lỗi/cảnh báo, bấm chuyển tới node lỗi. |
| AC-B3-39 | Lưu bằng nút Lưu và Ctrl+S (không mở hộp "Save page"); trạng thái chuyển "Đã lưu"; tải lại trang thấy đúng nội dung; draft còn lỗi kiểm tra vẫn lưu được. |
| AC-B3-40 | Có thay đổi chưa lưu: chuyển route trong app → dialog Rời trang / Ở lại; đóng tab/tải lại → cảnh báo `beforeunload`; không có thay đổi → không cảnh báo. |
| AC-B3-41 | Xung đột: mở cùng draft ở 2 tab, lưu tab A rồi lưu tab B → tab B nhận dialog xung đột (Tải bản mới nhất / Xuất JSON thay đổi của tôi), bản của tab A không bị ghi đè. |
| AC-B3-42 | Undo/redo (Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y) hoàn tác được thêm/xóa/di chuyển node, nối dây, sửa form, auto-layout; tối thiểu 100 bước. |
| AC-B3-43 | Copy/paste 2 node có dây nối giữa chúng → bản sao có id mới, giữ dây nội bộ, không nối vào node gốc. |
| AC-B3-44 | Auto-layout sắp node trái → phải không chồng nhau; minimap, zoom, fit view hoạt động. |
| AC-B3-45 | Sticky note thêm/sửa/xóa, lưu vào `ui.notes`, không ảnh hưởng engine và không xuất hiện trong diff. |
| AC-B3-46 | Export JSON tải file `.json` của bản hiện tại (kể cả chưa lưu); import lại file này qua màn Import cho ra flow tương đương. |
| AC-B3-47 | Version published/retired mở trong Designer ở chế độ chỉ xem: không sửa được, có nút "Tạo draft từ version này". |
| AC-B3-48 | Mở form `code.sql` → Monaco tải từ cùng origin (script, editor worker, font codicon); không có request tới jsDelivr hay domain ngoài nào; không có lỗi CSP trong console; autocomplete gợi ý tên view (port), cột và `$tham_so`. |
| AC-B3-49 | Bundle: entry chunk và chunk của User không chứa Monaco, React Flow, DuckDB (kiểm bằng phân tích build); Monaco chỉ được tải khi Admin mở Designer. |

### 26.3 (c) Xem trước từng node

**US-B3-03** — Là Admin, tôi muốn xem trước kết quả từng node bằng file mẫu trên máy, để kiểm tra cấu hình trước khi publish.

| # | Given / When / Then |
|---|---------------------|
| AC-B3-50 | Chọn file mẫu cho slot trong panel dữ liệu → hiện validation report như Run Wizard; không có request mạng chứa nội dung file; không có gì ghi vào localStorage/IndexedDB/Cache Storage ngoài file WASM. |
| AC-B3-51 | Chọn node `join` → "Xem trước" → chỉ các node tổ tiên của `join` được chạy (node khác nhánh và node phía sau không chạy, kiểm chứng qua sự kiện tiến độ). |
| AC-B3-52 | Bảng xem trước hiện tối đa 200 dòng đầu và tổng số dòng; node có nhiều port (VD `dedupe`) có tab cho từng port. |
| AC-B3-53 | Xem trước node `control.compare` hiện cả 4 bảng (Tổng hợp / Lệch / Chỉ có trong A / Chỉ có trong B) với số liệu khớp `expected.json` khi dùng fixture. |
| AC-B3-54 | Xem trước dùng cấu hình đang trên canvas kể cả chưa lưu; không tạo bản ghi `run_logs`. |
| AC-B3-55 | Slot thiếu file mẫu hoặc file mẫu lỗi `error` → node phụ thuộc báo rõ "Chưa có file mẫu cho {slot}" / "File mẫu của {slot} có lỗi"; tham số bắt buộc chưa nhập → yêu cầu nhập. |
| AC-B3-56 | Đóng Designer, tự đăng xuất hoặc đóng tab → file mẫu và kết quả xem trước bị giải phóng; mở lại Designer phải chọn lại file. |
| AC-B3-57 | File mẫu có header nhưng 0 dòng → xem trước hiện bảng rỗng có đủ cột và cảnh báo `noDataRows`. |

### 26.4 (d) Version & diff

**US-B3-04** — Là Admin, tôi muốn quản lý version và khoảng hiệu lực của flow, so sánh các version, để thay đổi quy định theo kỳ mà vẫn chạy lại được kỳ cũ.

| # | Given / When / Then |
|---|---------------------|
| AC-B3-60 | Màn Version liệt kê mọi version với trạng thái, khoảng hiệu lực, ghi chú, người/thời điểm publish; version đang áp dụng hôm nay có nhãn "Đang áp dụng". |
| AC-B3-61 | Publish draft thiếu ngày bắt đầu hoặc ghi chú (kể cả chỉ có khoảng trắng) → không gửi được, trường lỗi viền coral; gọi thẳng RPC với ghi chú rỗng → DB từ chối. |
| AC-B3-62 | Draft còn lỗi kiểm tra (port bắt buộc chưa nối, cột không tồn tại) → nút Publish bị chặn và liệt kê lỗi theo node (thay AC-13). |
| AC-B3-63 | **Given** v1 published từ 2026-01-01 không thời hạn, **when** publish v2 từ 2026-10-01 với checkbox bật, **then** v1 thành "từ 01/01/2026 đến trước 01/10/2026" và v2 published, trong cùng một giao dịch; User chạy kỳ 09/2026 dùng v1, kỳ 10/2026 dùng v2. |
| AC-B3-64 | Cùng tình huống nhưng bỏ chọn checkbox → DB từ chối do chồng lấn; UI hiện thông báo chồng lấn nêu v1, không có thay đổi nào được ghi. |
| AC-B3-65 | Publish tạo khoảng trống (VD v1 đến trước 2026-03-01, v2 từ 2026-04-01) → dialog cảnh báo khoảng trống trước khi xác nhận; sau publish, timeline hiện cảnh báo amber cho khoảng đó. |
| AC-B3-66 | Retire version published (có xác nhận) → trạng thái Retired, không còn được chọn khi chạy; User chạy kỳ thuộc khoảng của nó nhận lỗi "chưa có phiên bản hiệu lực"; không có nút đưa lại thành Published. |
| AC-B3-67 | Rollback: từ v1 (published/retired) "Tạo draft từ version này" → draft mới có `definition` giống hệt v1; publish thành v3 với ngày mới; v1 không thay đổi. |
| AC-B3-68 | Flow đã có draft → "Tạo draft từ version này" bị từ chối với thông báo §14.4, draft hiện có không bị ghi đè. |
| AC-B3-69 | Hủy draft (có xác nhận) → draft bị xóa; không có cách xóa version published/retired (UI không có nút; gọi API → lỗi `flow_version_immutable`). |
| AC-B3-70 | Đổi `effective_to` của version published → chỉ trường này thay đổi; chồng lấn → từ chối; mọi thao tác version có bản ghi `audit_logs`. |
| AC-B3-71 | Diff v1 với v2 (v2 thêm node `filter`, xóa một edge, đổi tolerance OT của compare từ 1 thành 5, đổi label một slot): liệt kê đúng 1 node thêm, 1 node sửa (JSON side-by-side tô dòng `tolerance`), edge thêm/xóa, 1 slot sửa. |
| AC-B3-72 | Hai version chỉ khác vị trí node/sticky note → "Hai phiên bản giống nhau về nội dung xử lý". |
| AC-B3-73 | Diff node `code.sql` hiển thị SQL theo từng dòng, dòng thay đổi được tô màu. |
| AC-B3-74 | User thường gọi các RPC mới (`admin_*`) → lỗi `42501`; `supabase/tests/rls.sql` có test tương ứng. |

### 26.5 (e) Tự đăng xuất sau 8 giờ

**US-B3-05** — Là người dùng (Admin hoặc User), tôi muốn được tự đăng xuất khi bỏ máy quá lâu, để người khác không dùng phiên của tôi; nhưng không bị đăng xuất giữa lúc flow đang chạy.

> Test dùng đồng hồ giả (fake timers / `page.clock`).

| # | Given / When / Then |
|---|---------------------|
| AC-B3-80 | **Given** đã đăng nhập, không thao tác, **when** tới mốc 7 giờ 55 phút, **then** hiện dialog cảnh báo có đếm ngược 5 phút và nút "Tiếp tục làm việc". |
| AC-B3-81 | Bấm "Tiếp tục làm việc" → dialog đóng, bộ đếm bắt đầu lại 8 giờ; di chuột khi dialog đang mở không đóng dialog. |
| AC-B3-82 | Không bấm → tại mốc 8 giờ: đăng xuất, session bị xóa khỏi `sessionStorage`, worker bị kết thúc, về màn đăng nhập với thông báo lý do (§6.1). |
| AC-B3-83 | Có thao tác chuột/phím/cuộn/chạm ở mốc 7 giờ → không có cảnh báo ở mốc 7 giờ 55 phút (bộ đếm đã bắt đầu lại). |
| AC-B3-84 | Flow chạy liên tục 9 giờ không thao tác → không bị đăng xuất trong lúc chạy; sau khi chạy xong, bộ đếm bắt đầu từ thời điểm kết thúc. Tương tự với xem trước trong Designer. |
| AC-B3-85 | Designer có thay đổi chưa lưu → dialog cảnh báo có thêm dòng nêu thay đổi chưa lưu sẽ mất; hết giờ thì đăng xuất mà không bị chặn bởi cảnh báo rời trang. |
| AC-B3-86 | Máy ngủ/tab ẩn 9 giờ rồi mở lại → đăng xuất ngay khi tab hiện lại (không hiện cảnh báo 5 phút). |
| AC-B3-87 | Hai tab cùng mở: thao tác ở tab A không gia hạn cho tab B (mỗi tab có phiên riêng). |
| AC-B3-88 | Không có request mạng hay ghi localStorage nào chứa sự kiện thao tác. |

### 26.6 (f) Sửa lỗi tồn từ bước 2 (HANDOFF §4)

| # | Given / When / Then |
|---|---------------------|
| AC-B3-90 | **Given** flow đang chạy, **when** User đổi kỳ (as-of date đổi version) rồi hủy cứng, **then** sau khi hủy, trạng thái kiểm tra version không kẹt ở "đang kiểm tra": hệ thống tự kiểm tra lại cho kỳ mới và nút Chạy dùng được mà không cần đổi kỳ lần nữa (`run-store.ts`: khi bỏ câu trả lời vì token đổi, lưu lại `deferredAsOf` để thử lại). Có unit test tái hiện. |
| AC-B3-91 | **Given** file import có slot chỉ nhận `.csv`, **when** import, **then** dialog hiện thông báo riêng cho `acceptCsvOnlyReplaced` ("chỉ nhận .csv nên đã chuyển sang nhận .xlsx, .xls"), còn slot có `.csv` lẫn định dạng khác hiện thông báo `acceptCsvRemoved`; cả hai theo nhãn hiển thị của slot. |
| AC-B3-92 | **Given** đăng nhập bằng User thường, **when** mở danh sách flow và trang chạy, **then** không có request nào tải chunk của khu vực Admin (kể cả Designer/Version) — kiểm bằng E2E theo dõi request JS; Admin vẫn vào khu Admin bình thường. |

---

## 27. Bước 4: `transform.formula` — User story & Acceptance criteria

> Phạm vi theo quyết định 2026-10-30 13:18 (§9.1, §12.2, Q16). Dữ liệu kiểm thử luôn là dữ liệu giả.

**US-B4-01** — Là Admin không biết code, tôi muốn thêm/sửa cột bằng công thức Excel quen thuộc, để cấu hình flow mà không phải viết SQL.

**US-B4-02** — Là Admin, tôi muốn thấy lỗi công thức ngay khi gõ và xem trước kết quả, để không phải chạy thử cả flow mới biết sai.

**US-B4-03** — Là User, tôi muốn biết dòng nào tính lỗi (mà file không bị lộ nội dung), để sửa dữ liệu nguồn.

### 27.1 Transpile & ngữ nghĩa

| # | Given / When / Then |
|---|---------------------|
| AC-B4-01 | **Given** công thức chỉ dùng 41 hàm §9.1, **when** lưu, **then** không có lỗi thiết kế; mỗi hàm có ít nhất 1 unit test transpile + chạy trên DuckDB. |
| AC-B4-02 | `=XLOOKUP(...)` → `formula.error.unknownFunction` kèm gợi ý dùng node Join; `=FOO(1)` → cùng mã lỗi kèm gợi ý `code.sql`; báo lúc thiết kế, không lỗi lúc chạy. |
| AC-B4-03 | Sai cú pháp (`=IF([A]>0,1`) → `formula.error.syntax` kèm vị trí ký tự; sai số đối số (`=ROUND(1)`) → `formula.error.argCount`. Thiếu `=` đầu → `formula.error.syntax`. |
| AC-B4-04 | Gõ `[Lương cơ bản]` (title) và `[luong_co_ban]` (key) cho cùng kết quả; giá trị lưu trong definition là `[luong_co_ban]`; đổi title ở node phía trên → công thức vẫn chạy và hiển thị theo title mới. |
| AC-B4-05 | 2 cột cùng title "Ghi chú" → `[Ghi chú]` báo `formula.error.ambiguousTitle`, `[ghi_chu_2]` chạy được. Title chứa `]` viết `]]` được nhận đúng. |
| AC-B4-06 | Cột B dùng cột A định nghĩa phía trên trong cùng node → chạy đúng; cột A dùng cột B phía dưới → `formula.error.forwardReference`. Ghi đè `luong` bằng `=[luong]*1.1` → dùng giá trị cũ; vị trí cột không đổi. |
| AC-B4-07 | Ô trống: `=[A]+1` → 1; `=[A]&"x"` → "x"; `=ISBLANK([A])` → TRUE; `=[A]=""` → TRUE; `=[A]=0` → TRUE; `=[A]` → trống; `=IF(TRUE,[A],0)` → trống; `=SUM([A],[B])` với A trống, B = 2 → 2. |
| AC-B4-08 | Decimal: `=0.1+0.2` → đúng `0.3`; `=1/3` → `0.3333333333`; `=[luong]*1.1` trên `1234567890123.25` không có sai số float; kết quả trong DuckDB là `DECIMAL(38,10)`, không có cột trung gian `DOUBLE` (kiểm SQL sinh ra). |
| AC-B4-09 | `=ROUND(2.675,2)` → 2.68; `=ROUND(-2.5,0)` → -3; `=ROUNDUP(-1.21,1)` → -1.3; `=ROUNDDOWN(1.29,1)` → 1.2; `=INT(-1.5)` → -2; `=MOD(-3,2)` → 1 (như Excel). |
| AC-B4-10 | Chuỗi: `="abc"="ABC"` → TRUE; `=FIND("a","ABa")` → 3; `=SEARCH("b*","aBc")` → 2; `=MID("Nguyễn",2,3)` → "guy"; `=LEN("Nguyễn")` → 6 (chuỗi NFC); `=PROPER("nguyễn văn a")` → "Nguyễn Văn A"; `=TEXTJOIN(", ",TRUE,"a","","b")` → "a, b". |
| AC-B4-11 | Chuyển kiểu: `="12"+1` → 13; `="abc"+1` → `#VALUE!`; `=TRUE+1` → 2; `=VALUE("1.5")` → 1.5. |
| AC-B4-12 | Ngày: `=[ngay_vao]+30` → `date`; `=[ngay_ra]-[ngay_vao]` → số ngày; `=EOMONTH(DATE(2026,2,10),0)` → 2026-02-28; `=EDATE(DATE(2026,1,31),1)` → 2026-02-28; `=DATEDIF(DATE(2020,3,15),DATE(2026,3,14),"Y")` → 5; `=WEEKDAY(DATE(2026,10,30),2)` → 5; `=DATE(2026,13,1)` → 2027-01-01. |
| AC-B4-13 | `PARAM("ky_luong")` với tham số `month` = 2026-09 → date 2026-09-01; tham số trống → trống; `PARAM("khong_co")` → `formula.error.unknownParam`. Giá trị tham số được bind (kiểm SQL sinh ra không chứa giá trị). |
| AC-B4-14 | Hằng chuỗi `"'); DROP TABLE x; --"` được bind như giá trị, kết quả là đúng chuỗi đó; SQL sinh ra không chứa hằng này. |
| AC-B4-15 | Suy diễn kiểu: `=[A]*2` → `decimal`; `=LEN([A])` → `decimal` (Admin đổi được `integer`); `=IF([A]>0,"Có",0)` → `string` + `formula.warning.mixedTypes`; Admin chọn `type: 'date'` cho `=LEN([A])` → `formula.error.typeMismatch`; `type: 'integer'` mà kết quả 1.5 → `#VALUE!` theo `onError`. |
| AC-B4-16 | Thứ tự dòng đầu ra = đầu vào; cột mới thêm cuối đúng thứ tự khai báo; schema suy diễn (§13.2) khớp kết quả chạy thật. |

### 27.2 Lỗi lúc chạy

| # | Given / When / Then |
|---|---------------------|
| AC-B4-20 | **Given** 1.000 dòng, 7 dòng có `[cong]` = 0, **when** chạy `=[luong]/[cong]` với `onError` mặc định, **then** 7 ô trống, cảnh báo `formula.warning.rowErrors` ghi `#DIV/0!: 7 dòng` và đúng 5 số dòng đầu tiên; nội dung cảnh báo (và run log) không chứa giá trị ô nào. |
| AC-B4-21 | Cùng dữ liệu với `onError: 'fail'` → lần chạy dừng, lỗi `formula.error.rowError` có node, cột, `#DIV/0!`, số dòng đầu tiên; không tạo file kết quả. |
| AC-B4-22 | `=IFERROR([luong]/[cong],0)` → 7 ô bằng 0, không có cảnh báo. |
| AC-B4-23 | Lỗi lan truyền: cột B = `=[A_loi]+1` với A_loi là cột lỗi (đã để trống theo `onError`) → B tính A_loi là trống (= 0), không báo lỗi lần 2. Trong cùng 1 công thức, lỗi ở biểu thức con lan ra cả công thức như Excel. |
| AC-B4-24 | Tràn số (`=10^30*10^30`) → `#NUM!` theo `onError`, không ra `duckdb.error.decimalOverflow`. |

### 27.3 Designer

| # | Given / When / Then |
|---|---------------------|
| AC-B4-40 | Gõ `[` trong ô công thức → danh sách gợi ý gồm cột đầu vào + cột phía trên trong node, hiển thị title, key, kiểu; chọn → chèn `[Title]`. Gõ `RO` → gợi ý `ROUND, ROUNDUP, ROUNDDOWN` kèm tooltip cú pháp tiếng Việt. |
| AC-B4-41 | Gõ công thức sai → trong ≤ 300 ms sau khi ngừng gõ có gạch đỏ đúng vị trí và thông báo tiếng Việt; sửa đúng → hết lỗi. |
| AC-B4-42 | Nút "Xem SQL đã sinh" hiện SQL chỉ đọc, tham số hiển thị dạng placeholder (`$1`…), không hiện giá trị. |
| AC-B4-43 | Bảng "Hàm hỗ trợ" liệt kê đủ 41 hàm theo nhóm, có cú pháp và ví dụ. |
| AC-B4-44 | Xem trước node formula bằng file mẫu hiện 200 dòng đầu với cột mới; cảnh báo `rowErrors` hiển thị trên node ở canvas và trong panel xem trước. |
| AC-B4-45 | Thêm/xóa/sắp lại cột công thức bằng bàn phím được; mọi control có nhãn a11y; Select kiểu và `onError` dùng Select tự làm (không `<select>`). |
| AC-B4-46 | Entry chunk (gzip) vẫn trong ngân sách bundle (MEMORY 2026-10-27 07:36); code transpiler dùng chung Designer/worker nhưng Monaco không vào chunk của User. |

### 27.4 Golden test & hiệu năng

| # | Given / When / Then |
|---|---------------------|
| AC-B4-30 | Claude sinh `fixtures/formula-golden/golden.xlsx` (dữ liệu giả; mỗi hàm ≥ 3 case gồm biên: ô trống, số âm, chuỗi có dấu, ngày cuối tháng/năm nhuận, lỗi). Harold mở bằng Excel thật, lưu thành `golden-excel.xlsx`. Test đọc giá trị Excel đã lưu và so với kết quả transpile: khớp tuyệt đối (số so sau làm tròn 15 chữ số có nghĩa như Excel hiển thị); khác biệt có chủ đích (VD decimal chính xác hơn Excel) liệt kê rõ trong file test. |
| AC-B4-31 | 1 triệu dòng × 30 cột + node formula 10 cột chạy xong không crash trên Chromium (`HRFLOW_PERF=1`). 100k × 30 với 5 cột công thức: thời gian chạy SQL công thức ≤ 2 giây trên máy 4 nhân, không tính thời gian đẩy dữ liệu vào DuckDB (chốt 2026-10-30 17:32) *(mục tiêu, đo báo cáo nếu không đạt)*. |

### 27.5 Sửa lỗi tồn (HANDOFF §4 #1)

| # | Given / When / Then |
|---|---------------------|
| AC-B4-90 | **Given** file .xlsx có entry giải nén > 2 GiB, hoặc entry giải nén > 16 MiB có tỉ lệ nén > 1:200, hoặc nhiều entry nhỏ cộng dồn vượt giới hạn tổng (zip bomb dữ liệu giả sinh trong test; chốt 2026-10-30 17:32), **when** đọc trong worker, **then** dừng giải nén sớm (không cấp phát hết bộ nhớ), báo lỗi i18n "File quá lớn để xử lý" trên đúng file, không crash worker; file .xlsx bình thường 1 triệu dòng × 30 cột vẫn đọc được. |

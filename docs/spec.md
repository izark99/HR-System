# HR Data Flow Platform — Đặc tả hệ thống (spec.md)

> Phiên bản: 0.1 (draft) · Ngày: 2026-10-26 · Chủ sở hữu: Harold (HR Analytics)
> Trạng thái: Chờ review

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
│ Postgres + RLS: users, groups, flows, versions…   │   │ Cron: keep-alive   │
│ Storage: template .xlsx (private bucket)          │   │  ping Supabase     │
│ Edge Functions: admin-users (service role)        │   └────────────────────┘
└───────────────────────────────────────────────────┘
```

### 4.1 Lý do chọn hạ tầng

| Thành phần | Lựa chọn | Lý do | Lưu ý free tier |
|------------|----------|-------|-----------------|
| Hosting SPA | **Cloudflare Pages** | Free, **cho phép dùng thương mại**, CDN nhanh | Vercel Hobby **cấm dùng thương mại** → không chọn |
| Backend | **Supabase Free** | Auth + Postgres + RLS + Storage + Edge Functions trong 1 gói | Project tự **pause sau 7 ngày không hoạt động** → cần keep-alive (§16) ; DB 500MB, Storage 1GB |
| Keep-alive | Cloudflare Workers Cron Trigger | Free, chạy định kỳ | Ping 1 lần/ngày |

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
| Canvas flow | @xyflow/react (React Flow) + ELK.js auto-layout | |
| Code editor | Monaco Editor | Highlight SQL / Python / formula, autocomplete tên cột |
| Data grid preview | TanStack Table + virtualization | Hiển thị hàng trăm nghìn dòng mượt |
| Chart | Apache ECharts | |
| Đọc Excel | SheetJS (bản CE từ cdn.sheetjs.com, vendor tại `vendor/`) | Đọc .xlsx, .xls (CSV không nhận, chốt 2026-10-26) |
| Ghi Excel | ExcelJS | Giữ style/format khi đổ vào template |
| Engine SQL | DuckDB-WASM | Chạy trong Web Worker |
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
- Session: access token ngắn hạn + refresh token, lưu trong `sessionStorage` (đóng tab là phải đăng nhập lại). Tự đăng xuất sau 8 giờ không thao tác, đếm phía client (bước 3) (chốt 2026-10-26).
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
| `ref_tables` | Bảng tham chiếu (định danh) | `id`, `code`, `name`, `columns` (jsonb: tên, kiểu) |
| `ref_table_versions` | Phiên bản bảng tham chiếu | `id`, `ref_table_id`, `effective_from`, `effective_to`, `rows` (jsonb) *hoặc* `storage_path` (Parquet nếu lớn), `row_count`, `status` |
| `templates` | Template Excel | `id`, `code`, `name`, `storage_path`, `sheets` (jsonb: metadata sheet/named range), `checksum` |
| `run_logs` | Nhật ký chạy (**không chứa nội dung dữ liệu**) | `id`, `user_id`, `flow_version_id`, `params` (jsonb), `inputs_meta` (jsonb: tên slot, số dòng, kích thước, SHA-256), `status`, `duration_ms`, `rows_out`, `error_code`, `error_node_id`, `client_info` |
| `audit_logs` | Nhật ký thao tác Admin | `id`, `actor_id`, `action`, `entity`, `entity_id`, `diff` (jsonb) |
| `app_settings` | Cấu hình hệ thống | `key`, `value` (jsonb) |

### 7.2 Ràng buộc quan trọng

- **Không chồng lấn effective date** giữa các version `published` của cùng flow / ref table: dùng exclusion constraint
  `EXCLUDE USING gist (flow_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&) WHERE (status = 'published')` (cần extension `btree_gist`).
- Version `published` là **bất biến (immutable)**: trigger chặn UPDATE `definition`; chỉ cho đổi `effective_to` và `status → retired`.
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
      "config": { "language": "excel", "column": "chenh_lech",
                  "expr": "=IF([cong_thuc_te]<>[cong_tinh_luong], [cong_thuc_te]-[cong_tinh_luong], 0)" } },
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

- `ui` chỉ phục vụ canvas, engine bỏ qua.
- Khi lưu: validate schema, kiểm tra DAG (không vòng), kiểm tra mọi port bắt buộc đã nối, kiểm tra tham chiếu (`refTable`, `template`, `slot`) tồn tại.

### 8.1 Tương thích schema (schema compatibility)

- Version đã Published là bất biến (§7.2) nên **mọi bản phát hành app sau này phải nạp được mọi version đã publish**.
- Thay đổi schema flow chỉ được phép theo 2 cách: (a) **bổ sung** (thêm trường tùy chọn có giá trị mặc định), hoặc (b) kèm một **bước tiền xử lý (preprocess migration)** trong `packages/flow-schema/src/migrate.ts` (`migrateFlowDefinition`) chuyển định nghĩa cũ sang dạng mới **trong bộ nhớ** trước khi parse (không sửa bản lưu trong database), và trả về ghi chú (notice) để hiển thị cho Admin.
- Engine (worker) luôn chạy `migrateFlowDefinition` trước `FlowDefinitionSchema`; màn Import flow của Admin hiển thị các notice.
- Bước tiền xử lý hiện có: bỏ `.csv` khỏi `inputSlots[].accept` (CSV không còn được nhận, chốt 2026-10-26 13:08); slot chỉ nhận `.csv` chuyển về mặc định `.xlsx, .xls`. Cả hai trường hợp đều có notice.

---

## 9. Xử lý dữ liệu: Excel · SQL · Python

Ba ngôn ngữ đều là **công dân hạng nhất** và có thể dùng ở hai mức:

| Mức | Excel | SQL | Python |
|-----|-------|-----|--------|
| **Cột tính toán** (node `transform.formula`) — 1 biểu thức → 1 cột | `=IF([A]>0,[A]*0.1,0)` | `CASE WHEN a > 0 THEN a*0.1 ELSE 0 END` | `df["a"].where(df["a"] > 0, 0) * 0.1` |
| **Node code** — nhận N bảng, trả về 1..N bảng | (không áp dụng) | `code.sql` | `code.python` |

### 9.1 Hàm Excel

- Cú pháp quen thuộc với HR: bắt đầu bằng `=`, tham chiếu cột bằng `[Tên cột]` (structured reference giống Excel Table).
- **Thực thi bằng transpile sang SQL DuckDB** → chạy vector hóa, nhanh trên cả triệu dòng.
- Danh sách hàm hỗ trợ trong MVP (ưu tiên hàm HR hay dùng):
  - Logic: `IF, IFS, AND, OR, NOT, IFERROR, IFNA, SWITCH, ISBLANK, ISNUMBER`
  - Toán: `ROUND, ROUNDUP, ROUNDDOWN, INT, ABS, MIN, MAX, MOD, SUM` (theo dòng)
  - Chuỗi: `LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, PROPER, CONCAT, TEXTJOIN, SUBSTITUTE, FIND, SEARCH, TEXT, VALUE`
  - Ngày: `DATE, YEAR, MONTH, DAY, TODAY, EDATE, EOMONTH, DATEDIF, NETWORKDAYS, WEEKDAY`
  - Tra cứu: `XLOOKUP, VLOOKUP` (tra cứu sang bảng khác trong flow → transpile thành LEFT JOIN)
  - Tham số: `PARAM("ky_luong")`
- Hàm chưa hỗ trợ → báo lỗi ngay khi Admin nhập (kèm gợi ý dùng SQL/Python), không lỗi lúc runtime.
- Có bộ test so sánh kết quả với Excel thật cho từng hàm (golden test).

### 9.2 SQL

- Dialect DuckDB. Mỗi input port của node xuất hiện dưới dạng một **view** cùng tên port (`left`, `right`, `df`, hoặc alias do Admin đặt).
- Câu lệnh phải là một `SELECT`/`WITH … SELECT` duy nhất; chặn `COPY`, `ATTACH`, `INSTALL`, `LOAD`, `EXPORT`, `PRAGMA` và các lệnh đọc file/URL (`read_csv('http…')`…).
- Tham số: `$ky_luong`, `$chi_nhanh` → bind bằng prepared statement.

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

`string`, `integer`, `decimal`, `boolean`, `date`, `datetime`. Tiền lương dùng `decimal(18,2)` (không dùng float) để tránh sai số làm tròn.

### 9.5 An toàn khi chạy code

- Chỉ Admin viết code; code nằm trong `flow_versions.definition` (đã publish, bất biến, có audit).
- Tham số do User nhập **chỉ được bind dưới dạng giá trị** (prepared statement / dict `params`), không bao giờ nối chuỗi vào code.
- **Content Security Policy** chặt: `connect-src` chỉ cho phép domain app + Supabase project → kể cả code Python/SQL cũng không gửi được dữ liệu ra ngoài.
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
| `output.preview` | Bảng xem trước trong app (virtualized, sort/filter phía client) |
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

| Nhóm | Node | Chức năng |
|------|------|-----------|
| **Input** | `input.excel` | Đọc file từ input slot |
| | `input.refTable` | Bảng tham chiếu (tự chọn version theo effective date) |
| | `input.params` | Bảng 1 dòng chứa tham số runtime |
| **Cột** | `transform.select` | Chọn / đổi tên / sắp xếp thứ tự cột |
| | `transform.formula` | Thêm/sửa cột bằng Excel, SQL hoặc Python |
| | `transform.cast` | Đổi kiểu dữ liệu |
| | `transform.split` / `transform.merge` | Tách / gộp cột |
| | `transform.fillDown` | Điền giá trị xuống (dữ liệu có ô merge) |
| **Dòng** | `transform.filter` | Lọc theo điều kiện (builder hoặc biểu thức) |
| | `transform.sort` | Sắp xếp |
| | `transform.dedupe` | Loại trùng theo khóa |
| | `transform.sample` / `transform.limit` | Lấy mẫu / giới hạn số dòng |
| **Kết hợp** | `transform.join` | Inner / left / right / full / anti join |
| | `transform.union` | Gộp dọc nhiều bảng (khớp theo tên cột) |
| | `transform.lookup` | Tra cứu nhanh (giống XLOOKUP) |
| **Tổng hợp** | `transform.groupBy` | Group + SUM/COUNT/AVG/MIN/MAX/COUNT DISTINCT |
| | `transform.pivot` / `transform.unpivot` | Xoay bảng |
| | `transform.window` | Running total, rank, lag/lead |
| **Kiểm soát** | `control.assert` | Kiểm tra điều kiện (VD: tổng lương 2 file khớp) → error/warning |
| | `control.compare` | Đối chiếu 2 bảng theo khóa → các bảng khớp / lệch / chỉ có ở A / chỉ có ở B |
| | `control.branch` | Chia luồng theo điều kiện tham số |
| **Code** | `code.sql` | SQL tùy chỉnh (§9.2) |
| | `code.python` | Python tùy chỉnh (§9.3) |
| **Output** | `output.preview`, `output.chart`, `output.excel`, `output.template` | §11 |
| **Tái sử dụng** | `subflow` (Phase 3) | Nhúng một flow khác như một node |

Mỗi node type được định nghĩa bằng một **plugin** gồm: Zod schema cấu hình, form cấu hình, hàm `compile` (sinh SQL) hoặc `execute` (chạy trực tiếp), hàm suy diễn schema output. Nhờ vậy việc thêm node mới không đụng đến core engine.

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
- **Cancel** bất kỳ lúc nào (terminate worker).
- **Schema inference**: canvas hiển thị danh sách cột ở mỗi node → autocomplete trong editor, phát hiện lỗi tên cột ngay khi thiết kế.
- **Preview từng node** trong Designer với file mẫu (chỉ nằm trong RAM của Admin, không upload).
- **Giới hạn bộ nhớ**: WASM 32-bit ≈ 4GB/tab. Mục tiêu thiết kế: ổn định tới **1 triệu dòng × 50 cột**. Flow cảnh báo khi file vượt ngưỡng do Admin cấu hình (`maxRows` mỗi slot).
- File rất lớn: tối ưu đọc .xlsx theo luồng (streaming) sẽ xem xét khi tích hợp DuckDB; hiện không nhận CSV (chốt 2026-10-26).

---

## 14. Versioning theo Effective Date

Áp dụng cho **flow** và **bảng tham chiếu**.

### 14.1 Vòng đời

```
Draft ──(Publish + chọn effective_from)──► Published ──(hết hiệu lực / thay thế)──► Retired
  ▲                                            │
  └────────────(Clone thành draft mới)─────────┘
```

- Mỗi flow có tối đa **1 draft** đang mở.
- Publish yêu cầu: `effective_from` (bắt buộc), `effective_to` (tùy chọn), `change_note`.
- Khi publish version mới có `effective_from = D` và version trước đang mở (`effective_to = null`) → hệ thống đề xuất tự đặt `effective_to = D` cho version trước (có xác nhận).
- Không cho phép khoảng hiệu lực chồng nhau (constraint DB, §7.2). Cho phép **khoảng trống** nhưng cảnh báo.
- **Rollback** = publish lại nội dung của một version cũ thành version mới với effective date mới (không sửa lịch sử).

### 14.2 Quy tắc chọn version khi chạy

- **Ngày tham chiếu (as-of date)** = giá trị của tham số mà Admin đánh dấu `isAsOfDate` (VD: `ky_luong` → ngày đầu tháng của kỳ). Nếu flow không có tham số này → dùng ngày hiện tại.
- Version được chọn: `effective_from <= as_of < coalesce(effective_to, +∞)`.
- Ref table trong flow cũng được chọn theo **cùng as-of date** → chạy lại kỳ cũ cho ra kết quả nhất quán với quy định của kỳ đó (VD: biểu thuế TNCN, mức lương tối thiểu vùng).
- Không có version hiệu lực → báo lỗi rõ ràng: "Flow chưa có phiên bản hiệu lực cho kỳ 03/2025".
- Run log lưu `flow_version_id` và version của các ref table đã dùng → có thể truy vết (audit).

### 14.3 So sánh version

Designer có chức năng **diff** giữa 2 version: node thêm/xóa/sửa, cấu hình thay đổi, code thay đổi (side-by-side).

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
- **Flow Designer** (canvas):
  - Bảng node bên trái (kéo thả), canvas ở giữa, panel cấu hình bên phải.
  - Panel dữ liệu bên dưới: preview output của node đang chọn (dùng file mẫu cục bộ).
  - Validate realtime (node lỗi viền đỏ + tooltip).
  - Undo/redo, copy/paste node, auto-layout, minimap, ghi chú (sticky note) trên canvas.
  - Export/Import flow ra file JSON (chuyển giữa môi trường, backup).
- **Ref Tables**: tạo/sửa bằng grid hoặc import từ Excel; quản lý version theo effective date.
- **Templates**: upload, xem danh sách sheet/named range.
- **Logs**: run log, audit log; lọc, xuất Excel.

---

## 16. Vận hành trên free tier

| Rủi ro | Giải pháp |
|--------|-----------|
| Supabase pause sau 7 ngày không hoạt động | Cloudflare Worker Cron ping 1 truy vấn nhẹ mỗi ngày; Admin dashboard cảnh báo nếu ping thất bại |
| Free tier không có backup tự động đầy đủ | GitHub Actions hằng tuần chạy `pg_dump` cấu hình (không chứa dữ liệu cá nhân) → lưu vào artifact private / Google Drive của HR; Export flow JSON định kỳ |
| Giới hạn DB 500MB / Storage 1GB | Run log tự xóa sau 12 tháng (cấu hình được); ref table lớn lưu dạng Parquet trong Storage |
| Pyodide/DuckDB tải chậm lần đầu | Service Worker cache asset WASM; preload ở màn hình đăng nhập |

---

## 17. Bảo mật & tuân thủ

- **Dữ liệu cá nhân không lưu trên server**: file Excel chỉ nằm trong bộ nhớ trình duyệt; đóng tab là mất. Không dùng IndexedDB để lưu file (trừ khi Admin bật tính năng "nhớ file mẫu" cho Designer — chỉ trên máy Admin).
- **Bảng tham chiếu** chỉ chứa dữ liệu **không mang tính cá nhân** (danh mục, mapping mã, biểu thuế, hệ số). Khi import, hệ thống cảnh báo nếu phát hiện cột có tên dạng `họ tên`, `CCCD`, `số điện thoại`, `email`, `mã NV`… (heuristic) và yêu cầu Admin xác nhận.
- **Run log** không chứa nội dung; tên file gốc được hash (SHA-256) thay vì lưu nguyên văn (tên file có thể chứa tên người).
- Tham chiếu pháp lý: Nghị định 13/2023/NĐ-CP; Luật Bảo vệ dữ liệu cá nhân 2025 (hiệu lực 01/01/2026). Thiết kế local-first giúp hạn chế tối đa việc xử lý/chuyển dữ liệu cá nhân ra nước ngoài. *(Cần bộ phận Pháp chế/IT của công ty xác nhận.)*
- HTTP security headers (cấu hình qua `_headers` của Cloudflare Pages): CSP chặt (§9.5), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS.
- Không log dữ liệu ra console ở bản production; không dùng dịch vụ analytics/tracking bên thứ ba.
- Supabase: tắt sign-up, bật RLS cho mọi bảng, chạy Supabase Security Advisor trước mỗi release.

---

## 18. Yêu cầu phi chức năng

| Hạng mục | Mục tiêu |
|----------|----------|
| Trình duyệt | Chrome, Edge (2 phiên bản mới nhất), desktop |
| Hiệu năng | 100k dòng × 30 cột, flow 15 node: < 10 giây (không có node Python) trên laptop 8GB RAM |
| UI | Tải trang đầu < 3 giây (chưa tính WASM engine); UI không bị treo khi engine chạy |
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
│  │  │  ├─ formula/              # Excel formula parser + transpiler → SQL
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
├─ workers/keep-alive/            # Cloudflare Cron Worker
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
- **Performance test**: bộ dữ liệu giả 100k / 500k / 1M dòng.
- Dữ liệu test **luôn là dữ liệu giả** (Faker), không dùng dữ liệu thật của công ty.

---

## 21. Phạm vi MVP & Roadmap

### Phase 1 — MVP (mục tiêu: chạy được flow nghiệm thu **đối chiếu bảng lương – chấm công**)
- Auth (username/password, đổi mật khẩu lần đầu, khóa tài khoản), Users, Groups, gán flow.
- Flow Designer canvas với các node: `input.excel`, `input.refTable`, `select`, `formula` (Excel + SQL), `filter`, `sort`, `join`, `union`, `groupBy`, `dedupe`, `control.compare`, `code.sql`, `output.preview`, `output.excel`.
- Input slot (hỗ trợ nhiều file / slot) + validation report.
- Flow nghiệm thu §24 chạy đúng với bộ dữ liệu giả `fixtures/payroll-timesheet/`.
- Draft/Published + effective date cho flow.
- Run Wizard + run log.
- Deploy Cloudflare Pages + Supabase + keep-alive.

### Phase 2 — Mở rộng xử lý & báo cáo
- `code.python` + formula Python (Pyodide).
- `output.template` (template Excel), `output.chart`.
- Ref table có effective date, import từ Excel.
- `control.assert`, `pivot/unpivot`, `window`, `lookup`, `fillDown`.
- Diff version, Export/Import flow JSON.

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
| ~~Q7~~ | Đã chốt 2026-10-26: tự đăng xuất sau 8 giờ không thao tác, làm phía client ở bước 3 | — |

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

### 24.4 Dữ liệu kiểm thử

`fixtures/payroll-timesheet/` — dữ liệu **giả** sinh bằng `generate.py` (seed cố định):
- 3 chi nhánh (CN01 30 NV, CN02 25 NV, CN03 20 NV) × 2 loại file.
- Sai lệch có chủ đích mỗi chi nhánh: 1 lệch công trong ngưỡng, 1 lệch công vượt ngưỡng, 1 lệch OT, 1 lệch phép + công, 1 NV chỉ có trong lương, 1 NV chỉ có trong chấm công.
- `expected.json` — kết quả kỳ vọng để tester so sánh.

---

## 25. Design system (UI)

Toàn bộ UI dùng **một** design language ("bright executive"), áp dụng như nhau cho phần User và Admin. Wireframe tham chiếu: https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (7 màn hình).

### 25.1 Typography

| Token | Giá trị |
|-------|---------|
| Font | `Be Vietnam Pro` (400–800), fallback `Arial, sans-serif`. Một family duy nhất, hỗ trợ đầy đủ tiếng Việt. **Self-host** trong app (woff2, subset Latin + Vietnamese), không gọi Google Fonts (chốt 2026-10-26) |
| Page title | 30px / 700 / letter-spacing −0.8px; viết như một câu kết luận ("Kỳ 09/2026 có 9 nhân viên lệch công cần xử lý") |
| Section title | 18px / 700 |
| Body | 14–15px / 400 |
| Label | 13–14px / 600 |
| Big number (KPI) | 44px / 800 |
| Eyebrow pill | 12px / 700 / uppercase / letter-spacing 0.06em |

### 25.2 Màu

| Vai trò | Fill | Text | Tint (nền nhạt) |
|---------|------|------|-----------------|
| Text | — | `#1F2A44` (đậm) · `#334155` (body) · `#475569` (phụ — không dùng xám nhạt hơn cho chữ) | — |
| Nền | `#F7FAF9` (trang) · `#FFFFFF` (card) · `#F1F5F9` (trung tính) | — | — |
| Teal — chính / tốt | `#14B8A6` (trang trí) · `#0F766E` (nút chính) | `#0F766E` | `#DDF5EF` / `#E3F8F3` |
| Coral — rủi ro / lỗi | `#F97362` | `#C2410C` | `#FFF1E7` |
| Amber — cảnh báo | `#FBBF24` | `#B45309` | `#FFF8E1` |
| Blue — thông tin / Admin | `#3B82F6` | `#1D4ED8` | `#EAF2FF` |
| Viền input / nút phụ | `#CBD5E1` | — | — |
| Đường kẻ bảng | `#E2E8F0` | — | — |

- Chữ trắng chỉ đặt trên `#0F766E`, `#1F2A44` hoặc `#1D4ED8` (đạt WCAG AA). Không đặt chữ trắng trên `#14B8A6`.
- Trang đăng nhập: nền gradient `linear-gradient(135deg, #E3F8F3, #F4FBFF, #FFF1E7)` + 3 vòng tròn trang trí (teal, coral, blue; opacity 0.35–0.5).

### 25.3 Component

| Component | Quy cách |
|-----------|----------|
| Card | Nền trắng, radius 20px (card lớn 24px), padding 24px, shadow `0 8px 28px rgba(31,42,68,0.08)`, không viền |
| KPI card | Như card + viền trên 8px theo ý nghĩa (teal khớp, coral lệch, amber cần xem) |
| Eyebrow pill | Trên mỗi tiêu đề trang; chữ màu trên nền tint; radius 999px |
| Status chip | 12px / 700, radius 999px, chữ màu trên nền tint |
| Nút chính | Cao 44px, radius 12px, nền `#0F766E`, chữ trắng 700 |
| Nút phụ | Cao 44px, radius 12px, nền trắng, viền `#CBD5E1`, chữ `#1F2A44` 600 |
| Input / select | Cao 42–46px, radius 12px, viền `#CBD5E1` |
| Tab | Dạng pill; tab đang chọn dùng nền tint + chữ màu đậm |
| Menu trái | Item cao 44px, radius 12px; item đang chọn nền `#DDF5EF`, chữ `#0F766E` 700 |
| Callout | Nền tint, radius 14–16px, mở đầu bằng nhãn in đậm (`An toàn dữ liệu:`, `Lưu ý:`, `Hợp lệ:`) |
| Bảng | Trong card; header `#475569` 600; dòng cần chú ý tô nền tint; ô chênh lệch tô coral tint |
| Node trên canvas | Card radius 16px; vạch màu trên theo nhóm node (blue đầu vào, coral kiểm soát, amber đầu ra); node đang chọn có ring teal |
| Month/Date picker | Tự làm, không dùng picker mặc định của trình duyệt. Nút trigger giống input, hiển thị "Tháng 10/2026" / `dd/MM/yyyy`; popover card radius 20px; lưới 12 tháng ("Th 1"…"Th 12") hoặc lịch tuần bắt đầu thứ Hai; ô chọn nền `#0F766E` chữ trắng; điều hướng bằng phím mũi tên, PageUp/PageDown đổi năm, Esc đóng (chốt 2026-10-26) |
| Vùng kéo thả file | Viền đứt 2px `#99E0D2`, nền `#F3FBF8`, radius 16px |

### 25.4 Giọng văn UI

- Xưng "bạn", câu ngắn, rõ hành động. Tiêu đề trang nói được kết luận chính.
- Định dạng số kiểu Việt Nam (`0,5`, `1.234.567`).
- Không dùng ký hiệu có thể thiếu trong font (≤ ≥ → × −) trong text UI; dùng chữ hoặc `-`.
- Touch target tối thiểu 44px; tương phản chữ đạt WCAG AA.

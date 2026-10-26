# HR Data Flow Platform

Webapp nội bộ xử lý dữ liệu Excel **trực tiếp trên trình duyệt**. Admin cấu hình các flow xử lý (đối chiếu, gộp file, tổng hợp báo cáo…) bằng giao diện, không cần code; User chỉ cần chọn flow, upload file, chạy và tải kết quả về.

> **Dữ liệu nhân sự không rời máy người dùng.** File Excel được đọc và xử lý trong Web Worker của trình duyệt; server chỉ lưu tài khoản, cấu hình flow và log metadata.

## Trạng thái

Đang ở **Phase 1 (MVP)**, flow nghiệm thu là *Đối chiếu bảng lương – chấm công*.

| Hạng mục | Trạng thái |
|----------|-----------|
| Đặc tả, nhật ký quyết định, design system | ✅ `docs/` |
| Engine: đọc Excel theo input slot, validation, node `control.compare`, xuất Excel nhiều sheet | ✅ có test (khớp `fixtures/payroll-timesheet/expected.json`) |
| DAG executor + Web Worker + 3 màn hình User | 🚧 đang làm |
| Supabase: đăng nhập, phân quyền (RLS), lưu flow/version | ⏳ tiếp theo |
| Flow Designer cho Admin | ⏳ sau đó |
| Python (Pyodide), template Excel | Phase 2 |

Wireframe giao diện: https://claude.ai/artifact/BUfBGjG3F8XyXmctD86QzW (link riêng tư, cần được chia sẻ mới xem được).

## Kiến trúc tóm tắt

```
Trình duyệt ─ React SPA (UI)
             └ Web Worker: SheetJS (đọc) → engine (validate, compare…) → ExcelJS (ghi)
                   ▲ file Excel không bao giờ upload
Supabase ──── chỉ metadata: auth, flow/version, bảng tham chiếu không chứa dữ liệu cá nhân, log
Cloudflare ── host SPA (Pages) + cron giữ Supabase không bị pause
```

Chi tiết: [`docs/spec.md`](docs/spec.md).

## Cấu trúc thư mục

```
apps/web/              React SPA + engine (src/engine: core, io, nodes)
packages/flow-schema/  Zod schema cho flow, input slot, cấu hình node
fixtures/              Dữ liệu GIẢ cho kiểm thử (+ script sinh dữ liệu)
vendor/                Thư viện vendored (SheetJS CE), có checksum
docs/
  spec.md              Đặc tả hệ thống
  MEMORY.md            Nhật ký quyết định (YYYYMMDD - Quyết định)
.claude/agents/        Team agent: requirements-analyst, developer, tester, reviewer
CLAUDE.md              Hướng dẫn làm việc cho Claude trên dự án
```

## Bắt đầu

Yêu cầu: Node ≥ 22, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev            # chạy app (Vite)
pnpm lint           # ESLint
pnpm typecheck      # TypeScript
pnpm test           # Vitest (engine chạy được trong Node)
pnpm build
pnpm format:check   # Prettier (CI dùng)
```

Sinh lại dữ liệu mẫu (cần Python 3 + openpyxl):

```bash
python3 fixtures/payroll-timesheet/generate.py
```

CI (GitHub Actions) chạy install → lint → format:check → typecheck → test → build trên mỗi push/PR.

## Nguyên tắc bắt buộc

- Không gửi nội dung file Excel / dữ liệu nhân sự lên server, không log ra console.
- Mọi bảng Supabase bật RLS; client không dùng service role key.
- Tham số người dùng chỉ được bind dưới dạng giá trị, không nối chuỗi vào SQL/code.
- Tiền tệ và ngày công tính bằng decimal, không dùng float.
- Dữ liệu test luôn là dữ liệu giả.
- Mọi quyết định đã chốt ghi vào `docs/MEMORY.md`.

## Công nghệ

TypeScript · React 19 · Vite · Tailwind CSS v4 · Zod · big.js · SheetJS CE · ExcelJS · i18next · Vitest — sắp tới: DuckDB-WASM, Pyodide, React Flow, Supabase, Cloudflare Pages.

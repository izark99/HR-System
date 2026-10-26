/**
 * Shared E2E helpers: fixture paths, fake workbook builders (SheetJS / ExcelJS resolved from the
 * web app's dependencies — the root has no runtime deps), a request recorder for the data-privacy
 * checks (AC-09) and page shortcuts. Fake data only.
 */
import { expect, type Locator, type Page, type Request } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import type * as ExcelJSModule from '../apps/web/node_modules/exceljs';
import type * as XLSXModule from '../apps/web/node_modules/xlsx';
import { join, resolve } from 'node:path';

const requireWeb = createRequire(resolve(import.meta.dirname, '../apps/web/package.json'));
export const XLSX = requireWeb('xlsx') as typeof XLSXModule;
export const ExcelJS = requireWeb('exceljs') as typeof ExcelJSModule;

export const FIXTURES = resolve(import.meta.dirname, '../fixtures/payroll-timesheet');
export const FLOW_URL = '/run/payroll-timesheet';
export const RESULT_URL = '/run/payroll-timesheet/result';

export function fixtures(prefix: 'bang_luong_' | 'cham_cong_'): string[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((f) => join(FIXTURES, f));
}

export type Cell = string | number | boolean | null;

export interface UploadPayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function workbook(name: string, sheets: Record<string, Cell[][]>): UploadPayload {
  const wb = XLSX.utils.book_new();
  for (const [sheet, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet);
  }
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { name, mimeType: XLSX_MIME, buffer };
}

export const PAYROLL_HEADERS = [
  'STT',
  'Mã NV',
  'Họ và tên',
  'Chi nhánh',
  'Công tính lương',
  'Giờ OT',
  'Ngày phép',
  'Nghỉ không lương',
];
export const TIMESHEET_HEADERS = [
  'Mã nhân viên',
  'Họ tên',
  'Chi nhánh',
  'Công thực tế',
  'OT (giờ)',
  'Phép (ngày)',
  'Không lương (ngày)',
];

/** [ma_nv, ho_ten, chi_nhanh, cong, ot, phep, khong_luong] */
export type EmpRow = [Cell, Cell, Cell, Cell, Cell, Cell, Cell];

export const nv = (i: number) => `NV${String(i).padStart(5, '0')}`;

export function employees(n: number, start = 1, branch = 'CN01', cong: Cell = 26): EmpRow[] {
  return Array.from({ length: n }, (_, k): EmpRow => {
    const i = start + k;
    return [nv(i), `Nhân viên Giả ${i}`, branch, cong, 4, 1, 0];
  });
}

/** Payroll sheet "Luong" shaped like the fixture: title row 1, header row 4, data from row 5. */
export function payrollAoa(
  rows: EmpRow[],
  opts: { headers?: string[]; total?: boolean } = {},
): Cell[][] {
  return [
    ['BẢNG LƯƠNG THÁNG 09/2026'],
    [],
    [],
    opts.headers ?? PAYROLL_HEADERS,
    ...rows.map((r, i): Cell[] => [i + 1, ...r]),
    ...(opts.total === false ? [] : [[null, null, 'TỔNG CỘNG']]),
  ];
}

export function payroll(
  name: string,
  rows: EmpRow[],
  opts: { headers?: string[]; total?: boolean; sheet?: string } = {},
): UploadPayload {
  return workbook(name, { [opts.sheet ?? 'Luong']: payrollAoa(rows, opts) });
}

export function timesheet(
  name: string,
  rows: EmpRow[],
  opts: { headers?: string[]; sheet?: string } = {},
): UploadPayload {
  return workbook(name, {
    [opts.sheet ?? 'ChamCong']: [opts.headers ?? TIMESHEET_HEADERS, ...rows],
  });
}

/** All distinct text cell values (names, IDs, branch codes…) of the given workbooks. */
export function textCellValues(paths: string[], minLength = 5): string[] {
  const values = new Set<string>();
  for (const p of paths) {
    const wb = XLSX.read(readFileSync(p));
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name]!, { header: 1 });
      for (const row of rows) {
        for (const v of row) {
          if (typeof v === 'string' && v.trim().length >= minLength) values.add(v.trim());
        }
      }
    }
  }
  return [...values];
}

export interface RecordedRequest {
  url: string;
  method: string;
  resourceType: string;
  body: string;
  fromWorker: boolean;
}

/** Records every request of the page and its workers (context-level, incl. service workers). */
export function recordRequests(page: Page): RecordedRequest[] {
  const all: RecordedRequest[] = [];
  const push = (req: Request) => {
    let body: string;
    try {
      body = req.postDataBuffer()?.toString('latin1') ?? '';
    } catch {
      body = '<unreadable>';
    }
    all.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      body,
      fromWorker: !hasFrame(req),
    });
  };
  page.context().on('request', push);
  return all;
}

function hasFrame(req: Request): boolean {
  try {
    req.frame();
    return true;
  } catch {
    return false; // requests issued by a worker have no frame
  }
}

export function runButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(Chạy|Đang)/ }).last();
}

export function payrollInput(page: Page): Locator {
  return page.getByLabel(/^Chọn file cho Bảng lương/);
}

export function timesheetInput(page: Page): Locator {
  return page.getByLabel(/^Chọn file cho Chấm công/);
}

export function payrollList(page: Page): Locator {
  return page.getByRole('list', { name: /File đã chọn cho Bảng lương/ });
}

export function timesheetList(page: Page): Locator {
  return page.getByRole('list', { name: /File đã chọn cho Chấm công/ });
}

export function reportCard(page: Page): Locator {
  return page.getByRole('region', { name: 'Báo cáo kiểm tra file' });
}

/** Trigger button of the custom month picker for the period param. */
export function periodButton(page: Page): Locator {
  return page.getByRole('button', { name: /Kỳ lương/ });
}

/** Pick `YYYY-MM` with the custom month picker (mouse): open, move to the year, click the month. */
export async function pickMonth(
  page: Page,
  value: string,
  trigger = periodButton(page),
): Promise<void> {
  const [year, month] = value.split('-').map(Number) as [number, number];
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 30; i++) {
    const shown = Number(await dialog.locator('[aria-live="polite"]').textContent());
    if (shown === year) break;
    await dialog.getByRole('button', { name: shown > year ? 'Năm trước' : 'Năm sau' }).click();
  }
  await dialog.getByRole('gridcell', { name: `Tháng ${month} năm ${year}` }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toContainText(`Tháng ${String(month).padStart(2, '0')}/${year}`);
}

/** Open the acceptance flow and fill the period. */
export async function openFlow(page: Page, period = '2026-09'): Promise<void> {
  await page.goto(FLOW_URL);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Đối chiếu bảng lương/);
  if (period) await pickMonth(page, period);
}

/** Open the flow, upload the 6 fixtures and wait until Run is enabled. */
export async function uploadFixtures(page: Page): Promise<void> {
  await openFlow(page);
  await payrollInput(page).setInputFiles(fixtures('bang_luong_'));
  await timesheetInput(page).setInputFiles(fixtures('cham_cong_'));
  await expect(runButton(page)).toHaveText('Chạy');
  await expect(runButton(page)).toBeEnabled();
}

export async function runToResult(page: Page): Promise<void> {
  await runButton(page).click();
  await expect(page).toHaveURL(new RegExp(`${RESULT_URL}$`), { timeout: 120_000 });
  await expect(page.getByTestId('kpi').first()).toBeVisible();
}

/** WCAG relative-luminance contrast ratio of two CSS rgb()/rgba() colors. */
export function contrastRatio(fg: string, bg: string): number {
  const lum = (css: string) => {
    const [r, g, b] = parseRgb(css).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

export function parseRgb(css: string): number[] {
  const srgb = css.match(/color\(srgb ([^)]+)\)/);
  if (srgb)
    return srgb[1]!
      .split(/\s+/)
      .slice(0, 3)
      .map((v) => Number(v) * 255);
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (m)
    return m[1]!
      .split(/[,\s/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(Number);
  const hex = css.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16));
  throw new Error(`unsupported color ${css}`);
}

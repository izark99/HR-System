/**
 * Shared definition of the AC-B3-24 performance flow (fake data only): a 30-column HR-like slot
 * (15 decimal + 11 string + 4 date) → filter → join (branch lookup slot) → groupBy → output.excel.
 * Used by the Node perf test and the heavy Chromium E2E (e2e/heavy-columnar.spec.ts), which
 * generate matching workbooks with the same headers.
 */
import type { FlowDefinitionInput } from '@hrflow/flow-schema';
import type ExcelJSModule from 'exceljs';

export const PERF_STRING_HEADERS = [
  ['ma_nv', 'Mã NV'],
  ['ho_ten', 'Họ tên'],
  ['chi_nhanh', 'Chi nhánh'],
  ['phong_ban', 'Phòng ban'],
  ['chuc_danh', 'Chức danh'],
  ['cap_bac', 'Cấp bậc'],
  ['gioi_tinh', 'Giới tính'],
  ['loai_hd', 'Loại HĐ'],
  ['email', 'Email'],
  ['ghi_chu', 'Ghi chú'],
  ['mst', 'Mã số thuế'],
] as const;

export const PERF_DATE_HEADERS = [
  ['ngay_vao', 'Ngày vào'],
  ['ngay_sinh', 'Ngày sinh'],
  ['ngay_hd', 'Ngày HĐ'],
  ['ngay_nghi', 'Ngày nghỉ'],
] as const;

export const PERF_DECIMALS = 15;
export const PERF_BRANCHES = 50;

/** Header row of the 30-column workbook. */
export function perfHeaders(): string[] {
  const out: string[] = [
    ...PERF_STRING_HEADERS.map(([, h]) => h),
    ...PERF_DATE_HEADERS.map(([, h]) => h),
  ];
  for (let c = 1; c <= PERF_DECIMALS; c++) out.push(`Số ${c}`);
  return out;
}

export function perfFlow(): FlowDefinitionInput {
  const dataColumns = [
    ...PERF_STRING_HEADERS.map(([key, h]) => ({
      key,
      label: h,
      aliases: [h],
      type: 'string' as const,
      ...(key === 'ma_nv' ? { required: true, rules: [{ unique: true as const }] } : {}),
    })),
    ...PERF_DATE_HEADERS.map(([key, h]) => ({
      key,
      label: h,
      aliases: [h],
      type: 'date' as const,
    })),
    ...Array.from({ length: PERF_DECIMALS }, (_, i) => ({
      key: `so_${i + 1}`,
      label: `Số ${i + 1}`,
      aliases: [`Số ${i + 1}`],
      type: 'decimal' as const,
    })),
  ];
  return {
    schemaVersion: 1,
    params: [],
    inputSlots: [
      {
        key: 'du_lieu',
        label: 'Dữ liệu nhân sự',
        required: true,
        accept: ['.xlsx'],
        sheet: { mode: 'byIndex', value: 0 },
        headerRow: 1,
        columns: dataColumns,
        skipRows: { whenBlank: ['ma_nv'] },
      },
      {
        key: 'chi_nhanh',
        label: 'Danh mục chi nhánh',
        required: true,
        accept: ['.xlsx'],
        sheet: { mode: 'byIndex', value: 0 },
        headerRow: 1,
        columns: [
          {
            key: 'chi_nhanh',
            label: 'Chi nhánh',
            aliases: ['Chi nhánh'],
            type: 'string',
            required: true,
          },
          { key: 'vung', label: 'Vùng', aliases: ['Vùng'], type: 'string' },
          { key: 'he_so', label: 'Hệ số', aliases: ['Hệ số'], type: 'decimal' },
        ],
      },
    ],
    nodes: [
      { id: 'in_data', type: 'input.excel', label: 'Dữ liệu', config: { slot: 'du_lieu' } },
      { id: 'in_cn', type: 'input.excel', label: 'Chi nhánh', config: { slot: 'chi_nhanh' } },
      {
        id: 'loc',
        type: 'transform.filter',
        label: 'Lọc',
        config: { conditions: [{ column: 'so_2', op: 'gte', value: 10 }] },
      },
      {
        id: 'ghep',
        type: 'transform.join',
        label: 'Ghép chi nhánh',
        config: {
          how: 'left',
          on: [{ left: 'chi_nhanh', right: 'chi_nhanh' }],
          rightColumns: ['vung', 'he_so'],
        },
      },
      {
        id: 'gop',
        type: 'transform.groupBy',
        label: 'Tổng hợp',
        config: {
          by: ['vung', 'chi_nhanh', 'phong_ban'],
          aggregations: [
            { key: 'so_nv', fn: 'countRows' },
            { key: 'tong_1', fn: 'sum', column: 'so_1' },
            { key: 'tong_6', fn: 'sum', column: 'so_6' },
            { key: 'tb_11', fn: 'avg', column: 'so_11' },
            { key: 'max_vao', fn: 'max', column: 'ngay_vao' },
          ],
        },
      },
      {
        id: 'xuat',
        type: 'output.excel',
        label: 'Xuất',
        config: { fileName: 'TongHop.xlsx', sheets: [{ name: 'Tổng hợp', port: 'in' }] },
      },
    ],
    edges: [
      { from: 'in_data', to: 'loc' },
      { from: 'loc', to: 'ghep', toPort: 'left' },
      { from: 'in_cn', to: 'ghep', toPort: 'right' },
      { from: 'ghep', to: 'gop' },
      { from: 'gop', to: 'xuat', toPort: 'in' },
    ],
  };
}

/** Rows of the branch lookup workbook (header first). */
export function perfBranchAoa(): (string | number)[][] {
  const aoa: (string | number)[][] = [['Chi nhánh', 'Vùng', 'Hệ số']];
  for (let b = 0; b < PERF_BRANCHES; b++) {
    aoa.push([`CN${String(b).padStart(2, '0')}`, `Vùng ${b % 5}`, 1 + (b % 4) / 10]);
  }
  return aoa;
}

/**
 * Write the 30-column fake workbook (sheet "Data", header row 1, fixed seed) with ExcelJS's
 * streaming writer: the generator itself never holds the rows in memory. ExcelJS is passed in
 * (Playwright loads it with require, Vitest with import).
 */
export async function writePerfWorkbook(
  ExcelJS: typeof ExcelJSModule,
  path: string,
  rows: number,
): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: path,
    useSharedStrings: true,
    useStyles: true,
  });
  const ws = wb.addWorksheet('Data');
  ws.addRow(perfHeaders()).commit();
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ho = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi'];
  for (let i = 1; i <= rows; i++) {
    const r: (string | number | Date | null)[] = [
      `NV${String(i).padStart(7, '0')}`,
      `${ho[i % 8]} Văn Giả ${i}`,
      `CN${String(i % PERF_BRANCHES).padStart(2, '0')}`,
      `Phòng ${i % 30}`,
      `Chức danh ${i % 200}`,
      `B${i % 9}`,
      i % 2 ? 'Nam' : 'Nữ',
      ['Chính thức', 'Thử việc', 'Thời vụ'][i % 3]!,
      `nv${i}@example.test`,
      i % 10 === 0 ? 'Ghi chú giả' : null,
      String(8000000000 + i),
      new Date(Date.UTC(2010 + (i % 15), i % 12, 1 + (i % 28))),
      new Date(Date.UTC(1970 + (i % 30), (i * 7) % 12, 1 + (i % 27))),
      new Date(Date.UTC(2020 + (i % 6), (i * 5) % 12, 1 + (i % 26))),
      i % 20 === 0 ? new Date(Date.UTC(2026, i % 12, 1 + (i % 28))) : null,
    ];
    for (let c = 0; c < PERF_DECIMALS; c++) {
      if (c === 0) r.push(20 + (i % 7) / 2);
      else if (c < 5) r.push(Math.round(rnd() * 1000) / 4);
      else if (c < 10) r.push(Math.round(rnd() * 5e7));
      else r.push(Math.round(rnd() * 1e9) / 100);
    }
    const row = ws.addRow(r);
    for (let c = 12; c <= 15; c++) row.getCell(c).numFmt = 'dd/mm/yyyy';
    row.commit();
  }
  ws.commit();
  await wb.commit();
}

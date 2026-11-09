import { describe, expect, it } from 'vitest';
import {
  cleanColumns,
  columnChanges,
  columnProblems,
  compactRow,
  diffRows,
  formatCell,
  keyFromTitle,
  looksPersonal,
  parseCell,
  parseColumns,
  personalColumns,
  rowKey,
  rowsBytes,
  tableProblems,
  type RefColumn,
} from '../model';

const COLS: RefColumn[] = [
  { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string', aliases: ['Mã CN'], isKey: true },
  { key: 'ten_cn', title: 'Tên chi nhánh', type: 'string', aliases: [], isKey: false },
  { key: 'vung', title: 'Vùng', type: 'integer', aliases: [], isKey: false },
];

describe('personal data heuristic (AC-RT-05)', () => {
  it.each([
    'Họ tên',
    'HỌ VÀ TÊN',
    'Họ tên giám đốc CN',
    'ho_ten',
    'Tên nhân viên',
    'Mã NV',
    'ma_nhan_vien',
    'Số CCCD',
    'CMND/CCCD',
    'Số điện thoại',
    'SĐT',
    'Email',
    'E-mail liên hệ',
    'Ngày sinh',
    'Địa chỉ thường trú',
    'Số tài khoản',
    'STK ngân hàng',
    'Mã số thuế cá nhân',
    'Số sổ BHXH',
    'Giới tính',
  ])('flags "%s"', (name) => {
    expect(looksPersonal(name)).toBe(true);
  });

  it.each([
    'Mã chi nhánh',
    'Tên chi nhánh',
    'Vùng lương tối thiểu',
    'Hệ số',
    'Bậc',
    'Mã ca',
    'Thuế suất',
    'Ngày hiệu lực',
    'Tên phòng ban',
    'Mã số thuế công ty',
    'Mã CN',
  ])('does not flag "%s"', (name) => {
    expect(looksPersonal(name)).toBe(false);
  });

  it('checks title, key and aliases', () => {
    const cols: RefColumn[] = [
      ...COLS,
      { key: 'gd', title: 'Giám đốc', type: 'string', aliases: ['Họ tên GĐ'], isKey: false },
      { key: 'dien_thoai', title: 'Liên hệ', type: 'string', aliases: [], isKey: false },
    ];
    expect(personalColumns(cols).map((c) => c.key)).toEqual(['gd', 'dien_thoai']);
  });
});

describe('column definitions (AC-RT-02)', () => {
  it('suggests a key from the title', () => {
    expect(keyFromTitle('Mã chi nhánh')).toBe('ma_chi_nhanh');
    expect(keyFromTitle('Đơn giá (VNĐ)')).toBe('don_gia_vnd');
    expect(keyFromTitle('2026 hệ số')).toBe('c_2026_he_so');
    expect(keyFromTitle('!!!')).toBe('');
  });

  it('reports invalid / repeated keys and titles', () => {
    const cols: RefColumn[] = [
      { ...COLS[0]! },
      { ...COLS[1]!, key: 'ma_cn' },
      { ...COLS[2]!, key: 'Vung', title: ' mã  CHI nhanh ' },
    ];
    expect(columnProblems(cols, 0)).toEqual(['keyDuplicate', 'titleDuplicate']);
    expect(columnProblems(cols, 2)).toEqual(['keyInvalid', 'titleDuplicate']);
    expect(columnProblems([{ ...COLS[0]!, title: '  ' }], 0)).toEqual(['titleRequired']);
  });

  it('needs a code, a name, columns and a key column', () => {
    expect(tableProblems('DM_CN', 'Danh mục', COLS)).toEqual([]);
    expect(tableProblems('dm', ' ', [])).toEqual(['codeInvalid', 'nameRequired', 'noColumns']);
    expect(tableProblems('DM', 'X', [{ ...COLS[1]! }])).toEqual(['noKey']);
  });

  it('cleans aliases (trimmed, no blank, no repeat of the title)', () => {
    const [c] = cleanColumns([
      { ...COLS[0]!, title: ' Mã chi nhánh ', aliases: [' Mã CN ', '', 'ma chi nhanh', 'Mã cn'] },
    ]);
    expect(c).toEqual({ ...COLS[0]!, aliases: ['Mã CN'] });
  });

  it('reads stored columns defensively', () => {
    expect(parseColumns(null)).toEqual([]);
    expect(
      parseColumns([{ key: 'a', title: 'A', type: 'weird', aliases: ['x', 1], isKey: true }, 5]),
    ).toEqual([{ key: 'a', title: 'A', type: 'string', aliases: ['x'], isKey: true }]);
  });

  it('lists removed, added and retyped columns', () => {
    const after: RefColumn[] = [
      COLS[0]!,
      { ...COLS[2]!, type: 'decimal' },
      { key: 'moi', title: 'Mới', type: 'string', aliases: [], isKey: false },
    ];
    expect(columnChanges(COLS, after)).toEqual({
      removed: ['ten_cn'],
      added: ['moi'],
      retyped: ['vung'],
      any: true,
    });
    expect(columnChanges(COLS, COLS).any).toBe(false);
  });
});

describe('cell values', () => {
  it('parses each type and keeps blanks null', () => {
    expect(parseCell('  CN01 ', 'string')).toEqual({ ok: true, value: 'CN01' });
    expect(parseCell('', 'integer')).toEqual({ ok: true, value: null });
    expect(parseCell('42', 'integer')).toEqual({ ok: true, value: 42 });
    expect(parseCell('-7', 'integer')).toEqual({ ok: true, value: -7 });
    expect(parseCell('1.5', 'integer')).toEqual({ ok: false, problem: 'type' });
    expect(parseCell('1,000', 'integer')).toEqual({ ok: false, problem: 'type' });
    expect(parseCell('99999999999999999', 'integer')).toEqual({ ok: false, problem: 'type' });
    expect(parseCell('0012.500', 'decimal')).toEqual({ ok: true, value: '12.5' });
    expect(parseCell('.25', 'decimal')).toEqual({ ok: true, value: '0.25' });
    expect(parseCell('-0.0', 'decimal')).toEqual({ ok: true, value: '0' });
    expect(parseCell('1,5', 'decimal')).toEqual({ ok: false, problem: 'type' });
    expect(parseCell('1e3', 'decimal')).toEqual({ ok: false, problem: 'type' });
    expect(parseCell('0.12345678901', 'decimal')).toEqual({ ok: false, problem: 'tooPrecise' });
    expect(parseCell('0.1234567890', 'decimal')).toEqual({ ok: true, value: '0.123456789' });
    expect(parseCell('1/7/2026', 'date')).toEqual({ ok: true, value: '2026-07-01' });
    expect(parseCell('2026-07-01', 'date')).toEqual({ ok: true, value: '2026-07-01' });
    expect(parseCell('29/02/2026', 'date')).toEqual({ ok: false, problem: 'type' });
    expect(parseCell('29/02/2028', 'date')).toEqual({ ok: true, value: '2028-02-29' });
    expect(parseCell('31/04/2026', 'date')).toEqual({ ok: false, problem: 'type' });
    expect(parseCell('TRUE', 'boolean')).toEqual({ ok: true, value: true });
    expect(parseCell('Không', 'boolean')).toEqual({ ok: true, value: false });
    expect(parseCell('có', 'boolean')).toEqual({ ok: true, value: true });
    expect(parseCell('maybe', 'boolean')).toEqual({ ok: false, problem: 'type' });
  });

  it('formats stored values for the grid and round-trips them', () => {
    expect(formatCell('2026-07-01', 'date')).toBe('01/07/2026');
    expect(formatCell(true, 'boolean')).toBe('TRUE');
    expect(formatCell(false, 'boolean')).toBe('FALSE');
    expect(formatCell(null, 'string')).toBe('');
    expect(formatCell(1, 'integer')).toBe('1');
    for (const [v, t] of [
      ['2026-12-31', 'date'],
      [true, 'boolean'],
      ['-3.75', 'decimal'],
      [12, 'integer'],
    ] as const) {
      expect(parseCell(formatCell(v, t), t)).toEqual({ ok: true, value: v });
    }
  });
});

describe('keys and size', () => {
  it('compares keys without case and extra spaces; blank key = null', () => {
    const keys = COLS.filter((c) => c.isKey);
    expect(rowKey({ ma_cn: ' cn01 ' }, keys)).toBe(rowKey({ ma_cn: 'CN01' }, keys));
    expect(rowKey({ ma_cn: 'CN  01' }, keys)).toBe(rowKey({ ma_cn: 'cn 01' }, keys));
    expect(rowKey({ ma_cn: '  ' }, keys)).toBeNull();
    expect(rowKey({}, keys)).toBeNull();
    const two: RefColumn[] = [keys[0]!, { ...COLS[2]!, isKey: true }];
    expect(rowKey({ ma_cn: 'A', vung: 1 }, two)).not.toBe(rowKey({ ma_cn: 'A', vung: 2 }, two));
  });

  it('measures rows like jsonb text (spaces after ":" and ",")', () => {
    expect(rowsBytes([])).toBe(2); // []
    // [{"a": 1}] → 10 bytes
    expect(rowsBytes([{ a: 1 }])).toBe(10);
    // [{"a": 1, "b": "Đà"}, {"a": 2}] → 34 bytes ("Đ" and "à" are 2 bytes each)
    expect(rowsBytes([{ a: 1, b: 'Đà' }, { a: 2 }])).toBe(
      new TextEncoder().encode('[{"a": 1, "b": "Đà"}, {"a": 2}]').length,
    );
  });

  it('leaves blank cells out of stored rows', () => {
    expect(compactRow({ ma_cn: 'CN01', ten_cn: null, vung: 0 }, COLS)).toEqual({
      ma_cn: 'CN01',
      vung: 0,
    });
  });
});

describe('diff by key (AC-RT-06)', () => {
  it('counts added, removed, changed and unchanged rows', () => {
    const before = [
      { ma_cn: 'CN01', ten_cn: 'Hồ Chí Minh', vung: 1 },
      { ma_cn: 'CN02', ten_cn: 'Hà Nội', vung: 1 },
      { ma_cn: 'CN05', ten_cn: 'Hậu Giang', vung: 3 },
    ];
    const after = [
      { ma_cn: 'CN01', ten_cn: 'Hồ Chí Minh', vung: 1 },
      { ma_cn: 'CN05', ten_cn: 'Hậu Giang', vung: 2 },
      { ma_cn: 'CN25', ten_cn: 'Long An' },
    ];
    const d = diffRows(COLS, before, after);
    expect(d.unchanged).toBe(1);
    expect(d.added.map((r) => r.ma_cn)).toEqual(['CN25']);
    expect(d.removed.map((r) => r.ma_cn)).toEqual(['CN02']);
    expect(d.changed).toEqual([
      { key: 'CN05', before: before[2], after: after[1], columns: ['vung'] },
    ]);
  });

  it('matches keys without case; a key written differently is a change', () => {
    const d = diffRows(COLS, [{ ma_cn: 'CN01' }], [{ ma_cn: ' cn01' }]);
    expect(d.added).toEqual([]);
    expect(d.changed.map((c) => c.columns)).toEqual([['ma_cn']]);
  });

  it('treats a missing value and null alike', () => {
    const d = diffRows(COLS, [{ ma_cn: 'A', vung: null }], [{ ma_cn: 'A' }]);
    expect(d.unchanged).toBe(1);
  });
});

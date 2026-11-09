import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import designer from '../../locales/vi/designer.json';
import fields from '../../locales/vi/engine-fields.json';
import { checkDesign } from '../design';
import { setupFieldLabel } from '../field-path';
import { nodeDuckDb } from './duckdb-node';
import { t } from './sql-helpers';

const FLOW = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../../fixtures/payroll-timesheet/flow.json'),
    'utf8',
  ),
) as {
  inputSlots: Record<string, unknown>[];
  params: Record<string, unknown>[];
};

describe('setup field labels (HANDOFF §4.12a)', () => {
  it('says a slot path by the labels of the Input slot form', () => {
    expect(setupFieldLabel(t, 'slot', 'headerRow')).toBe('Dòng tiêu đề');
    expect(setupFieldLabel(t, 'slot', 'columns.0.type')).toBe('Cột 1, Kiểu dữ liệu');
    expect(setupFieldLabel(t, 'slot', 'columns.2.rules.1.regex')).toBe(
      'Cột 3, Quy tắc kiểm tra, dòng 2, Biểu thức regex',
    );
    expect(setupFieldLabel(t, 'slot', 'columns.0.aliases.1')).toBe(
      'Cột 1, Tên cột trong file, dòng 2',
    );
    expect(setupFieldLabel(t, 'slot', 'multiple.minFiles')).toBe('Số file tối thiểu');
    expect(setupFieldLabel(t, 'slot', 'skipRows.whenBlank.0')).toBe('Cột khóa, dòng 1');
    expect(setupFieldLabel(t, 'slot', 'sheet.value')).toBe('Chọn sheet');
    expect(setupFieldLabel(t, 'slot', 'stopAt.blankRows')).toBe(
      'Dừng khi gặp số dòng trống liên tiếp',
    );
    expect(setupFieldLabel(t, 'slot', '')).toBe('cấu hình chung');
  });

  it('says a param path by the labels of the Tham số form', () => {
    expect(setupFieldLabel(t, 'param', 'type')).toBe('Kiểu');
    expect(setupFieldLabel(t, 'param', 'options.0.label')).toBe('Lựa chọn, dòng 1, Nhãn');
    expect(setupFieldLabel(t, 'param', 'isAsOfDate')).toBe('Dùng làm ngày hiệu lực');
  });

  it('labels are the same words as the Designer forms', () => {
    const fp = fields;
    const s = designer.slot;
    const p = designer.params;
    const pairs: [string, string][] = [
      [fp.columnN, s.columnN],
      [fp.slot.key, s.key],
      [fp.slot.label, s.label],
      [fp.slot.required, s.required],
      [fp.slot.accept, s.accept],
      [fp.slot.sheet, s.sheetMode],
      [fp.slot.headerRow, s.headerRow],
      [fp.slot.headerRows, s.headerRows],
      [fp.slot.dataStartRow, s.dataStartRow],
      [fp.slot.stopAt, s.stopAt],
      [fp.slot.skipRows, s.skipRows],
      [fp.slot.whenBlank, s.whenBlank],
      [fp.slot.whenKeyContains, s.whenKeyContains],
      [fp.slot.unmergeCells, s.unmerge],
      [fp.slot.columns, s.columns],
      [fp.slot.extraColumns, s.extraColumns],
      [fp.slot.multiple, s.multiple],
      [fp.slot.minFiles, s.minFiles],
      [fp.slot.maxFiles, s.maxFiles],
      [fp.slot.maxRows, s.maxRows],
      [fp.column.key, s.col.key],
      [fp.column.label, s.col.label],
      [fp.column.aliases, s.col.aliases],
      [fp.column.type, s.col.type],
      [fp.column.presence, s.col.presence],
      [fp.column.required, s.col.required],
      [fp.column.defaultValue, s.col.defaultValue],
      [fp.column.dateFormats, s.col.dateFormats],
      [fp.column.decimalSeparator, s.col.decimalSeparator],
      [fp.column.rules, s.col.rules],
      [fp.rule.unique, s.rule.kind],
      [fp.rule.regex, s.rule.regexValue],
      [fp.rule.min, s.rule.minValue],
      [fp.rule.max, s.rule.maxValue],
      [fp.rule.severity, s.rule.severity],
      [fp.param.key, p.key],
      [fp.param.label, p.label],
      [fp.param.type, p.type],
      [fp.param.required, p.required],
      [fp.param.log, p.log],
      [fp.param.isAsOfDate, p.asOf],
      [fp.param.options, p.options],
      [fp.option.value, p.optionValue],
      [fp.option.label, p.optionLabel],
    ];
    for (const [a, b] of pairs) expect(a).toBe(b);
  });

  it('design-check messages of a slot and a param never show the config path', async () => {
    const flow = structuredClone(FLOW);
    flow.inputSlots[0]!.headerRows = 9;
    (flow.inputSlots[0]!.columns as Record<string, unknown>[])[0]!.type = 'money';
    flow.params[0]!.type = 'color';
    const r = await checkDesign(flow, { t, duck: nodeDuckDb });
    const texts = r.issues
      .filter((i) => i.slotIndex !== undefined || i.paramIndex !== undefined)
      .map((i) => i.text);
    expect(texts).toContain(
      `Mục upload "${String(flow.inputSlots[0]!.label)}": giá trị ở mục "Số dòng tiêu đề" không hợp lệ.`,
    );
    expect(texts).toContain(
      `Mục upload "${String(flow.inputSlots[0]!.label)}": giá trị ở mục "Cột 1, Kiểu dữ liệu" không hợp lệ.`,
    );
    expect(texts).toContain(
      `Tham số "${String(flow.params[0]!.label)}": giá trị ở mục "Kiểu" không hợp lệ.`,
    );
    for (const text of texts) expect(text).not.toMatch(/headerRows|columns\.|\btype\b/);
    // The raw path stays on the issue: the Designer uses it to focus the field.
    expect(r.issues.some((i) => i.path === 'columns.0.type')).toBe(true);
  });
});

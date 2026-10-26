/** QA (tester) — schema edge cases. */
import { describe, expect, it } from 'vitest';
import { CompareConfigSchema, InputSlotSchema, OutputExcelConfigSchema } from './index';

const col = { key: 'ma_nv', aliases: ['Mã NV'], type: 'string' } as const;

describe('QA schema: input slot', () => {
  it('rejects dataStartRow inside the header block and minFiles > maxFiles', () => {
    const base = { key: 's', label: 'S', columns: [col] };
    expect(InputSlotSchema.safeParse({ ...base, headerRow: 4, dataStartRow: 4 }).success).toBe(
      false,
    );
    expect(
      InputSlotSchema.safeParse({ ...base, headerRow: 4, headerRows: 2, dataStartRow: 5 }).success,
    ).toBe(false);
    expect(
      InputSlotSchema.safeParse({ ...base, multiple: { enabled: true, minFiles: 3, maxFiles: 2 } })
        .success,
    ).toBe(false);
  });

  it('rejects unsupported date format tokens and non snake_case keys', () => {
    const base = { key: 's', label: 'S' };
    expect(
      InputSlotSchema.safeParse({
        ...base,
        columns: [{ key: 'd', aliases: ['D'], type: 'date', dateFormats: ['dd/MMM/yyyy Q'] }],
      }).success,
    ).toBe(false);
    expect(
      InputSlotSchema.safeParse({ ...base, columns: [{ ...col, key: 'Ma NV' }] }).success,
    ).toBe(false);
  });
});

describe('QA schema: compare & output', () => {
  it('rejects duplicate metric labels and tolerance strings that are not plain decimals', () => {
    const m = { left: 'a', right: 'a', label: 'A' };
    expect(CompareConfigSchema.safeParse({ keys: ['k'], metrics: [m, m] }).success).toBe(false);
    for (const tolerance of ['1e-3', '.5', '0,5', 'abc']) {
      expect(
        CompareConfigSchema.safeParse({ keys: ['k'], metrics: [{ ...m, tolerance }] }).success,
        tolerance,
      ).toBe(false);
    }
  });

  it('output sheet names: > 31 chars and forbidden characters are rejected', () => {
    const cfg = (name: string) => ({ sheets: [{ name, port: 'p' }] });
    expect(OutputExcelConfigSchema.safeParse(cfg('x'.repeat(32))).success).toBe(false);
    expect(OutputExcelConfigSchema.safeParse(cfg('a/b')).success).toBe(false);
    expect(OutputExcelConfigSchema.safeParse(cfg('Chỉ có trong chấm công')).success).toBe(true);
  });
});

describe('QA schema: fixed bugs (were KNOWN BUGS)', () => {
  it('BUG-W1: output sheet name with a leading/trailing apostrophe is rejected', () => {
    // ExcelJS throws at write time for such names; the schema catches it at design time.
    for (const name of ["'Lệch'", "'Lệch", "Lệch'"]) {
      expect(
        OutputExcelConfigSchema.safeParse({ sheets: [{ name, port: 'p' }] }).success,
        name,
      ).toBe(false);
    }
    // An apostrophe inside the name is allowed.
    expect(
      OutputExcelConfigSchema.safeParse({ sheets: [{ name: "NV's", port: 'p' }] }).success,
    ).toBe(true);
  });

  it('BUG-C1: negative tolerance is rejected', () => {
    const r = CompareConfigSchema.safeParse({
      keys: ['k'],
      metrics: [{ left: 'a', right: 'a', label: 'A', tolerance: -0.5 }],
    });
    expect(r.success).toBe(false);
    const ok = (tolerance: string | number) =>
      CompareConfigSchema.safeParse({
        keys: ['k'],
        metrics: [{ left: 'a', right: 'a', label: 'A', tolerance }],
      }).success;
    expect([ok('-1'), ok(-0.5)]).toEqual([false, false]);
    expect([ok('0'), ok(0), ok('0.5'), ok(1)]).toEqual([true, true, true, true]);
  });

  it('BUG-S1: output sheet names must be unique (case-insensitive)', () => {
    // Previously "Lệch" and "LỆCH" passed and the writer silently renamed the second to "LỆCH (2)".
    const r = OutputExcelConfigSchema.safeParse({
      sheets: [
        { name: 'Lệch', port: 'a' },
        { name: 'LỆCH', port: 'b' },
      ],
    });
    expect(r.success).toBe(false);
  });
});

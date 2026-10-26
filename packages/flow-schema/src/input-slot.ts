import { z } from 'zod';
import { DataTypeSchema, DecimalLiteralSchema, IdentifierSchema, SeveritySchema } from './common';

/** Input slot definition (spec §10). */

const severity = SeveritySchema.default('error');

export const UniqueRuleSchema = z.strictObject({ unique: z.literal(true), severity });
export const RegexRuleSchema = z.strictObject({
  regex: z.string().min(1),
  severity,
});
export const MinRuleSchema = z.strictObject({ min: DecimalLiteralSchema, severity });
export const MaxRuleSchema = z.strictObject({ max: DecimalLiteralSchema, severity });

export const ColumnRuleSchema = z.union([
  UniqueRuleSchema,
  RegexRuleSchema,
  MinRuleSchema,
  MaxRuleSchema,
]);
export type ColumnRule = z.infer<typeof ColumnRuleSchema>;

/**
 * Date formats: tokens `yyyy`, `MM`/`M`, `dd`/`d`, `HH`, `mm`, `ss` plus literal separators,
 * or the special value `excelSerial` (numeric Excel date serial).
 * `dd`/`MM` also accept a single digit ("1/9/2026").
 */
export const DateFormatSchema = z.union([
  z.literal('excelSerial'),
  z.string().regex(/^[dMyHms/.\-: T]+$/, 'unsupported date format'),
]);

export const SlotColumnSchema = z.strictObject({
  key: IdentifierSchema,
  label: z.string().optional(),
  /** Header texts accepted for this column; compared after normalization (no diacritics, lowercase, collapsed spaces). */
  aliases: z.array(z.string().min(1)).min(1),
  type: DataTypeSchema,
  /** Column must exist in the file and every data row must have a value. */
  required: z.boolean().default(false),
  rules: z.array(ColumnRuleSchema).default([]),
  dateFormats: z.array(DateFormatSchema).min(1).optional(),
  /** For numbers stored as text: which character is the decimal separator (the other is thousands). */
  decimalSeparator: z.enum(['.', ',']).default('.'),
});
export type SlotColumn = z.infer<typeof SlotColumnSchema>;
export type SlotColumnInput = z.input<typeof SlotColumnSchema>;

export const SheetSelectorSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('byName'), value: z.string().min(1) }),
  /** 0-based sheet index. */
  z.strictObject({ mode: z.literal('byIndex'), value: z.number().int().min(0) }),
  /** First sheet whose header row contains every required column. */
  z.strictObject({ mode: z.literal('firstMatchingHeaders') }),
]);
export type SheetSelector = z.infer<typeof SheetSelectorSchema>;

export const InputSlotSchema = z
  .strictObject({
    key: IdentifierSchema,
    label: z.string().min(1),
    required: z.boolean().default(true),
    accept: z.array(z.string().regex(/^\.[a-z0-9]+$/)).default(['.xlsx', '.xls', '.csv']),
    sheet: SheetSelectorSchema.default({ mode: 'byIndex', value: 0 }),
    /** 1-based Excel row number of the (first) header row. */
    headerRow: z.number().int().min(1).default(1),
    /** Number of header rows; >1 joins the texts of each column with " / ". */
    headerRows: z.number().int().min(1).max(5).default(1),
    /** 1-based Excel row number of the first data row. Defaults to headerRow + headerRows. */
    dataStartRow: z.number().int().min(1).optional(),
    /** Stop reading after N consecutive blank rows. */
    stopAt: z.strictObject({ blankRows: z.number().int().min(1) }).optional(),
    /**
     * Rows in which ALL of these columns are blank are not data (e.g. a "TỔNG CỘNG" total row or a
     * signature block). They are excluded and listed in the report's `skippedRows`, not as errors.
     * Without this, a blank value in a required column is reported as an error.
     */
    skipRows: z.strictObject({ whenBlank: z.array(IdentifierSchema).min(1) }).optional(),
    /** `fillDown`: every cell of a merged range in the data area gets the top-left value. */
    unmergeCells: z.enum(['none', 'fillDown']).default('none'),
    columns: z.array(SlotColumnSchema).min(1),
    extraColumns: z.enum(['drop', 'keep']).default('drop'),
    multiple: z
      .strictObject({
        enabled: z.boolean().default(false),
        minFiles: z.number().int().min(1).default(1),
        maxFiles: z.number().int().min(1).default(50),
      })
      .default({ enabled: false, minFiles: 1, maxFiles: 50 }),
    /** Warn when a file has more data rows than this. */
    maxRows: z.number().int().min(1).optional(),
  })
  .superRefine((slot, ctx) => {
    const keys = slot.columns.map((c) => c.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) {
      ctx.addIssue({ code: 'custom', path: ['columns'], message: `duplicate column key "${dup}"` });
    }
    for (const k of slot.skipRows?.whenBlank ?? []) {
      if (!keys.includes(k)) {
        ctx.addIssue({
          code: 'custom',
          path: ['skipRows', 'whenBlank'],
          message: `unknown column key "${k}"`,
        });
      }
    }
    const dataStart = slot.dataStartRow ?? slot.headerRow + slot.headerRows;
    if (dataStart < slot.headerRow + slot.headerRows) {
      ctx.addIssue({
        code: 'custom',
        path: ['dataStartRow'],
        message: 'dataStartRow must be after the header rows',
      });
    }
    if (slot.multiple.minFiles > slot.multiple.maxFiles) {
      ctx.addIssue({
        code: 'custom',
        path: ['multiple'],
        message: 'minFiles must be <= maxFiles',
      });
    }
  });
export type InputSlot = z.infer<typeof InputSlotSchema>;
export type InputSlotInput = z.input<typeof InputSlotSchema>;

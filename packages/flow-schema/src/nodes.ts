import { z } from 'zod';
import { NonNegativeDecimalLiteralSchema } from './common';

/** Config of node `control.compare` (spec §24.2). */
export const CompareMetricSchema = z.strictObject({
  left: z.string().min(1),
  right: z.string().min(1),
  label: z.string().min(1),
  /** Mismatch when |right − left| > tolerance. Must be >= 0. */
  tolerance: NonNegativeDecimalLiteralSchema.default('0'),
});
export type CompareMetric = z.infer<typeof CompareMetricSchema>;

export const CompareConfigSchema = z
  .strictObject({
    /** Key columns; same column name on both sides. */
    keys: z.array(z.string().min(1)).min(1),
    metrics: z.array(CompareMetricSchema).min(1),
    /** Display columns carried into `mismatched` (taken from left, falling back to right). */
    carryColumns: z.array(z.string().min(1)).default([]),
    /** Treat null as 0; otherwise null vs a number is a mismatch (null vs null matches). */
    nullAsZero: z.boolean().default(true),
    /** Side names used in output column titles, e.g. "Công (lương)". Default: i18n "A"/"B". */
    sideLabels: z.strictObject({ left: z.string().min(1), right: z.string().min(1) }).optional(),
  })
  .superRefine((cfg, ctx) => {
    const labels = cfg.metrics.map((m) => m.label);
    const dup = labels.find((l, i) => labels.indexOf(l) !== i);
    if (dup) {
      ctx.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: `duplicate metric label "${dup}"`,
      });
    }
  });
export type CompareConfig = z.infer<typeof CompareConfigSchema>;
export type CompareConfigInput = z.input<typeof CompareConfigSchema>;

/**
 * Excel sheet name: 1–31 chars, none of : \ / ? * [ ], and no leading/trailing apostrophe
 * (Excel and ExcelJS reject those).
 */
export const ExcelSheetNameSchema = z
  .string()
  .min(1)
  .max(31)
  .regex(/^[^:\\/?*[\]]+$/, 'invalid Excel sheet name')
  .refine((n) => !n.startsWith("'") && !n.endsWith("'"), {
    message: 'Excel sheet name cannot start or end with an apostrophe',
  });

/** Config of node `output.excel` (spec §11): one sheet per input port. */
export const OutputExcelConfigSchema = z
  .strictObject({
    fileName: z.string().min(1).default('output.xlsx'),
    sheets: z
      .array(
        z.strictObject({
          name: ExcelSheetNameSchema,
          /** Input port of this node that feeds the sheet. */
          port: z.string().min(1),
        }),
      )
      .min(1),
  })
  .superRefine((cfg, ctx) => {
    // Excel treats sheet names case-insensitively ("Lệch" and "LỆCH" clash).
    const seen = new Set<string>();
    cfg.sheets.forEach((sheet, i) => {
      const k = sheet.name.toLowerCase();
      if (seen.has(k)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sheets', i, 'name'],
          message: `duplicate sheet name "${sheet.name}" (case-insensitive)`,
        });
      }
      seen.add(k);
    });
  });
export type OutputExcelConfig = z.infer<typeof OutputExcelConfigSchema>;

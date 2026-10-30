import { z } from 'zod';
import { IdentifierSchema } from './common';

/**
 * Configs of the step-3 nodes (spec §12.1). Column references are column `key`s of the schema
 * inferred for the upstream node; whether they exist is checked by the node plugin
 * (`inferSchema`), not here, because it depends on the rest of the flow.
 */

const ColumnRefSchema = z.string().min(1);

/** `transform.select` (§12.1.1): pick / rename / reorder columns. */
export const SelectConfigSchema = z.strictObject({
  columns: z
    .array(
      z.strictObject({
        from: ColumnRefSchema,
        key: IdentifierSchema.optional(),
        title: z.string().min(1).optional(),
      }),
    )
    .min(1),
});
export type SelectConfig = z.infer<typeof SelectConfigSchema>;

/** Constant in a node config. Read according to the column type (`date` as YYYY-MM-DD, …). */
export const LiteralSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
export type Literal = z.infer<typeof LiteralSchema>;

export const FILTER_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
  'isBlank',
  'notBlank',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

/** Ops that compare against one `value` (a literal or a runtime param). */
export const FILTER_SINGLE_VALUE_OPS: readonly FilterOp[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
];
/** Ops that take the `values` list. */
export const FILTER_LIST_OPS: readonly FilterOp[] = ['in', 'notIn'];

export const FilterConditionSchema = z
  .strictObject({
    column: ColumnRefSchema,
    op: z.enum(FILTER_OPS),
    value: z.union([LiteralSchema, z.strictObject({ param: IdentifierSchema })]).optional(),
    values: z.array(LiteralSchema).min(1).max(500).optional(),
  })
  .superRefine((c, ctx) => {
    if (FILTER_SINGLE_VALUE_OPS.includes(c.op) && c.value === undefined) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: `op "${c.op}" needs a value` });
    }
    if (FILTER_LIST_OPS.includes(c.op) && c.values === undefined) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: `op "${c.op}" needs values` });
    }
  });
export type FilterCondition = z.infer<typeof FilterConditionSchema>;

/** `transform.filter` (§12.1.2). */
export const FilterConfigSchema = z.strictObject({
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(FilterConditionSchema).min(1),
  /** Compare strings after key normalization (NFC, whitespace, lowercase). Decision 2026-10-27. */
  normalizeText: z.boolean().default(true),
});
export type FilterConfig = z.infer<typeof FilterConfigSchema>;

/** `transform.sort` (§12.1.3). */
export const SortConfigSchema = z.strictObject({
  by: z
    .array(
      z.strictObject({
        column: ColumnRefSchema,
        direction: z.enum(['asc', 'desc']).default('asc'),
        blanks: z.enum(['first', 'last']).default('last'),
      }),
    )
    .min(1),
});
export type SortConfig = z.infer<typeof SortConfigSchema>;

/** `transform.join` (§12.1.4). */
export const JoinConfigSchema = z.strictObject({
  how: z.enum(['inner', 'left', 'right', 'full', 'anti']),
  on: z.array(z.strictObject({ left: ColumnRefSchema, right: ColumnRefSchema })).min(1),
  normalizeKeys: z.boolean().default(true),
  /** Columns taken from `right`; default: every right column that is not a join key. */
  rightColumns: z.array(ColumnRefSchema).optional(),
  rightSuffix: z
    .string()
    .regex(/^_[a-z0-9_]+$/, 'must look like "_r"')
    .default('_r'),
});
export type JoinConfig = z.infer<typeof JoinConfigSchema>;

/** `transform.union` (§12.1.5). Ports `in_1` … `in_N`, N = inputCount. */
export const UnionConfigSchema = z
  .strictObject({
    inputCount: z.number().int().min(2).max(10).default(2),
    missingColumns: z.enum(['null', 'error']).default('null'),
    sourceColumn: z.strictObject({ key: IdentifierSchema, labels: z.array(z.string()) }).optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.sourceColumn && cfg.sourceColumn.labels.length !== cfg.inputCount) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceColumn', 'labels'],
        message: `needs exactly ${cfg.inputCount} labels`,
      });
    }
  });
export type UnionConfig = z.infer<typeof UnionConfigSchema>;

export const AGGREGATION_FNS = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'countDistinct',
  'countRows',
] as const;
export type AggregationFn = (typeof AGGREGATION_FNS)[number];

/** `transform.groupBy` (§12.1.6). */
export const GroupByConfigSchema = z.strictObject({
  by: z.array(ColumnRefSchema).default([]),
  aggregations: z
    .array(
      z
        .strictObject({
          key: IdentifierSchema,
          title: z.string().min(1).optional(),
          fn: z.enum(AGGREGATION_FNS),
          column: ColumnRefSchema.optional(),
        })
        .superRefine((a, ctx) => {
          if (a.fn !== 'countRows' && a.column === undefined) {
            ctx.addIssue({
              code: 'custom',
              path: ['column'],
              message: `fn "${a.fn}" needs a column`,
            });
          }
        }),
    )
    .min(1),
});
export type GroupByConfig = z.infer<typeof GroupByConfigSchema>;

/** `transform.dedupe` (§12.1.7). Ports: `out` (kept rows), `removed` (dropped rows). */
export const DedupeConfigSchema = z.strictObject({
  keys: z.array(ColumnRefSchema).min(1),
  keep: z.enum(['first', 'last']).default('first'),
  normalizeKeys: z.boolean().default(true),
});
export type DedupeConfig = z.infer<typeof DedupeConfigSchema>;

/** `code.sql` (§12.1.8, §9.2): one view per input port, a single SELECT. */
export const CodeSqlConfigSchema = z
  .strictObject({
    inputs: z
      .array(z.strictObject({ port: IdentifierSchema }))
      .min(1)
      .max(10),
    sql: z.string().min(1).max(100_000),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.inputs.forEach((input, i) => {
      if (seen.has(input.port)) {
        ctx.addIssue({
          code: 'custom',
          path: ['inputs', i, 'port'],
          message: `duplicate port "${input.port}"`,
        });
      }
      seen.add(input.port);
    });
  });
export type CodeSqlConfig = z.infer<typeof CodeSqlConfigSchema>;

/** `output.preview` (§12.1.10): an in-app, view-only result tab. */
export const OutputPreviewConfigSchema = z.strictObject({
  title: z.string().trim().min(1).max(60),
  columns: z.array(ColumnRefSchema).optional(),
  maxRows: z.number().int().min(1).max(1_000_000).default(100_000),
});
export type OutputPreviewConfig = z.infer<typeof OutputPreviewConfigSchema>;

/** Column types of `transform.formula`; `auto` = inferred from the formula (§12.2). */
export const FORMULA_TYPES = ['auto', 'string', 'integer', 'decimal', 'boolean', 'date'] as const;
export type FormulaType = (typeof FORMULA_TYPES)[number];

/** `transform.formula` (§12.2): computed columns from Excel formulas, evaluated top to bottom. */
export const FormulaConfigSchema = z
  .strictObject({
    columns: z
      .array(
        z.strictObject({
          /** New column, or key of an existing column to overwrite. */
          key: IdentifierSchema,
          title: z.string().trim().min(1).max(200).optional(),
          /** Starts with "=" (checked by the transpiler, with the character position). */
          formula: z.string().max(2000),
          type: z.enum(FORMULA_TYPES).default('auto'),
          onError: z.enum(['blank', 'fail']).default('blank'),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.columns.forEach((c, i) => {
      if (seen.has(c.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['columns', i, 'key'],
          message: `duplicate column "${c.key}"`,
        });
      }
      seen.add(c.key);
    });
  });
export type FormulaConfig = z.infer<typeof FormulaConfigSchema>;
export type FormulaConfigInput = z.input<typeof FormulaConfigSchema>;

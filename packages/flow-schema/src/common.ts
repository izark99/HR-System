import { z } from 'zod';

/** Canonical data types (spec §9.4). Money/day values use `decimal`, never float. */
export const DataTypeSchema = z.enum([
  'string',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
]);
export type DataType = z.infer<typeof DataTypeSchema>;

export const SeveritySchema = z.enum(['error', 'warning']);
export type Severity = z.infer<typeof SeveritySchema>;

/** Machine identifier used for column keys, slot keys, param keys, node ids. */
export const IdentifierSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]*$/, 'must be snake_case: [a-z_][a-z0-9_]*');

/**
 * Decimal literal. Accepts a JSON number or a decimal string ("0.5", "-12.25").
 * Strings are preferred in stored flows because they survive round-trips without float noise.
 */
export const DecimalLiteralSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string like "0.5"'),
]);
export type DecimalLiteral = z.infer<typeof DecimalLiteralSchema>;

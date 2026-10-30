import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DataType } from '@hrflow/flow-schema';
import { Big, isDecimal } from '../core/decimal';
import type { Value } from '../core/types';
import { runNode, table } from './sql-helpers';

/** Cases of fixtures/formula-golden/cases.json (generated with golden.xlsx, fake data). */

export const GOLDEN_DIR = resolve(import.meta.dirname, '../../../../../fixtures/formula-golden');

export interface Expect {
  type: 'number' | 'string' | 'boolean' | 'date' | 'error' | 'blank';
  value: string | boolean | null;
}

export interface FormulaCase {
  id: string;
  fn: string;
  formula: string;
  inputs: Record<string, { type: 'n' | 's' | 'd' | 'b'; value: string | boolean | null }>;
  expect: Expect;
  /** Intended difference: what Excel gives instead. */
  excel?: Expect;
  note?: string;
  /** Excel behaviour to be confirmed by the golden file. */
  confirm?: string;
}

export function loadCases(): FormulaCase[] {
  return JSON.parse(readFileSync(resolve(GOLDEN_DIR, 'cases.json'), 'utf8')) as FormulaCase[];
}

const TYPES: Record<string, DataType> = { n: 'decimal', s: 'string', d: 'date', b: 'boolean' };

/** Engine result of one case: value (decimal as string) or the error code of the row. */
export async function runCase(c: FormulaCase): Promise<Expect> {
  const keys = Object.keys(c.inputs);
  const cols: [string, DataType][] =
    keys.length > 0 ? keys.map((k) => [k, TYPES[c.inputs[k]!.type]!]) : [['x', 'string']];
  const row: Value[] =
    keys.length > 0
      ? keys.map((k) => {
          const { type, value } = c.inputs[k]!;
          if (value === null) return null;
          return type === 'n' ? new Big(String(value)) : value;
        })
      : ['x'];
  const r = await runNode(
    'transform.formula',
    { columns: [{ key: 'r', formula: c.formula }] },
    { in: table(cols, [row]) },
  );
  const w = r.warnings.find((x) => x.messageKey === 'formula.warning.rowErrors');
  if (w) return { type: 'error', value: String(w.params.error) };
  const out = r.out.out!;
  const col = out.columns.find((x) => x.key === 'r')!;
  const v = out.rows[0]!.r;
  if (v === null || v === undefined) return { type: 'blank', value: null };
  if (isDecimal(v)) return { type: 'number', value: v.toString() };
  if (typeof v === 'number') return { type: 'number', value: String(v) };
  if (col.type === 'date') return { type: 'date', value: String(v) };
  return { type: typeof v === 'boolean' ? 'boolean' : 'string', value: v };
}

/** Normalize an expectation for comparison (numbers through Big). */
export function norm(e: Expect): Expect {
  if (e.type === 'number' && e.value !== null)
    return { ...e, value: new Big(String(e.value)).toString() };
  return e;
}

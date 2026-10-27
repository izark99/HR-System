import {
  FilterConfigSchema,
  type FilterCondition,
  type FilterConfig,
  type FlowDefinition,
  type Literal,
} from '@hrflow/flow-schema';
import { normalizeKeyPart } from '../core/keys';
import type { NodePlugin } from '../core/plugin';
import type { ColumnDef, ParamValue } from '../core/types';
import { DUCK_TYPE, isBlank, normKey, q, qName, SqlBuilder } from '../duckdb/sql';
import {
  configError,
  findColumn,
  IN_PORT,
  isBlankParam,
  literalForType,
  OUT_PORT,
  paramToSql,
} from './shared';

const ORDERED = new Set(['integer', 'decimal', 'date', 'datetime', 'string']);
const TEXT_OPS = new Set(['contains', 'notContains', 'startsWith', 'endsWith']);
const ORDER_OPS = new Set(['gt', 'gte', 'lt', 'lte']);

function checkCondition(
  c: FilterCondition,
  i: number,
  input: readonly ColumnDef[],
  flow: FlowDefinition | undefined,
): ColumnDef {
  const path = `conditions.${i}`;
  const col = findColumn(input, c.column, 'filter.error.unknownColumn', `${path}.column`);
  if (
    (TEXT_OPS.has(c.op) && col.type !== 'string') ||
    (ORDER_OPS.has(c.op) && !ORDERED.has(col.type))
  ) {
    throw configError('filter.error.opNotForType', `${path}.op`, {
      column: c.column,
      op: c.op,
      type: col.type,
    });
  }
  const literals: [Literal, string][] = [];
  if (c.value !== undefined) {
    if (typeof c.value === 'object') {
      const param = c.value.param;
      if (flow && !flow.params.some((p) => p.key === param)) {
        throw configError('filter.error.unknownParam', `${path}.value.param`, { param });
      }
    } else literals.push([c.value, `${path}.value`]);
  }
  c.values?.forEach((v, j) => literals.push([v, `${path}.values.${j}`]));
  for (const [v, p] of literals) {
    if (literalForType(v, col.type) === null) {
      throw configError('filter.error.invalidValue', p, { column: c.column, type: col.type });
    }
  }
  return col;
}

/** `transform.filter` (spec §12.1.2). DuckDB; values are bound, never inlined. */
export const transformFilterPlugin: NodePlugin<FilterConfig> = {
  type: 'transform.filter',
  configSchema: FilterConfigSchema,
  inputs: [{ name: IN_PORT, required: true }],
  outputs: [{ name: OUT_PORT, required: false }],
  inferSchema(config, inputs, ctx) {
    const input = inputs[IN_PORT] ?? [];
    config.conditions.forEach((c, i) => checkCondition(c, i, input, ctx.flow));
    return { [OUT_PORT]: [...input] };
  },
  runSql(config, inputs, ctx) {
    const input = inputs[IN_PORT]!;
    const b = new SqlBuilder();
    const parts: string[] = [];
    config.conditions.forEach((c, i) => {
      const col = checkCondition(c, i, input.columns, ctx.flow);
      let value: Literal | undefined;
      if (c.value !== undefined && typeof c.value === 'object') {
        const raw: ParamValue | undefined = ctx.run.params[c.value.param];
        // A blank param drops its condition (optional filters, e.g. "all branches").
        if (isBlankParam(raw)) return;
        value = paramToSql(raw)!;
        if (literalForType(value, col.type) === null) {
          throw configError('filter.error.invalidValue', `conditions.${i}.value`, {
            column: c.column,
            type: col.type,
          });
        }
      } else value = c.value;

      const text = col.type === 'string';
      const normalize = text && config.normalizeText;
      const x = normalize ? normKey(q(col.key)) : q(col.key);
      const blank = isBlank(q(col.key), col.type);
      const bind = (v: Literal) => {
        const s = literalForType(v, col.type)!;
        const bound = b.param(normalize ? normalizeKeyPart(s) : s);
        return text ? bound : `CAST(${bound} AS ${DUCK_TYPE[col.type]})`;
      };
      switch (c.op) {
        case 'isBlank':
          parts.push(`(${blank})`);
          break;
        case 'notBlank':
          parts.push(`(NOT ${blank})`);
          break;
        case 'eq':
          parts.push(`(NOT ${blank} AND ${x} = ${bind(value!)})`);
          break;
        case 'neq':
          parts.push(`(${blank} OR ${x} <> ${bind(value!)})`);
          break;
        case 'gt':
          parts.push(`(NOT ${blank} AND ${x} > ${bind(value!)})`);
          break;
        case 'gte':
          parts.push(`(NOT ${blank} AND ${x} >= ${bind(value!)})`);
          break;
        case 'lt':
          parts.push(`(NOT ${blank} AND ${x} < ${bind(value!)})`);
          break;
        case 'lte':
          parts.push(`(NOT ${blank} AND ${x} <= ${bind(value!)})`);
          break;
        case 'in':
          parts.push(`(NOT ${blank} AND ${x} IN (${c.values!.map(bind).join(', ')}))`);
          break;
        case 'notIn':
          parts.push(`(${blank} OR ${x} NOT IN (${c.values!.map(bind).join(', ')}))`);
          break;
        case 'contains':
          parts.push(`(NOT ${blank} AND contains(${x}, ${bind(value!)}))`);
          break;
        case 'notContains':
          parts.push(`(${blank} OR NOT contains(${x}, ${bind(value!)}))`);
          break;
        case 'startsWith':
          parts.push(`(NOT ${blank} AND prefix(${x}, ${bind(value!)}))`);
          break;
        case 'endsWith':
          parts.push(`(NOT ${blank} AND suffix(${x}, ${bind(value!)}))`);
          break;
      }
    });
    const where =
      parts.length > 0 ? ` WHERE ${parts.join(config.match === 'all' ? ' AND ' : ' OR ')}` : '';
    const sql = `SELECT * FROM ${qName(input.name)}${where}`;
    return { [OUT_PORT]: ctx.sql.derive([input], input.columns, sql, b.params) };
  },
};

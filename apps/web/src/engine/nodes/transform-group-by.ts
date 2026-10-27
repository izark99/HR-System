import BigJs from 'big.js';
import { GroupByConfigSchema, type GroupByConfig } from '@hrflow/flow-schema';
import { Big, decimalFrom, type Decimal } from '../core/decimal';
import type { NodePlugin } from '../core/plugin';
import type { ColumnDef, Row } from '../core/types';
import { isBlank, ORD, q, qName } from '../duckdb/sql';
import { configError, findColumn, IN_PORT, OUT_PORT, passColumn } from './shared';

/** big.js constructor for `avg`: division rounded half-up to 10 places in one step (§12.1.6). */
const AvgBig = BigJs();
AvgBig.DP = 10;
AvgBig.RM = AvgBig.roundHalfUp;

const NUMERIC = new Set(['integer', 'decimal']);
const ORDERED = new Set(['integer', 'decimal', 'date', 'datetime', 'string']);

interface GroupPlan {
  by: ColumnDef[];
  aggs: { key: string; fn: GroupByConfig['aggregations'][number]['fn']; source?: ColumnDef }[];
  columns: ColumnDef[];
}

function planGroupBy(config: GroupByConfig, input: readonly ColumnDef[]): GroupPlan {
  const columns: ColumnDef[] = [];
  const by = config.by.map((key, i) => {
    const col = findColumn(input, key, 'groupBy.error.unknownColumn', `by.${i}`);
    if (columns.some((c) => c.key === key)) {
      throw configError('groupBy.error.duplicateKey', `by.${i}`, { key });
    }
    columns.push(passColumn(col));
    return col;
  });
  const aggs = config.aggregations.map((a, i) => {
    const path = `aggregations.${i}`;
    if (columns.some((c) => c.key === a.key)) {
      throw configError('groupBy.error.duplicateKey', `${path}.key`, { key: a.key });
    }
    const source =
      a.fn === 'countRows' || a.column === undefined
        ? undefined
        : findColumn(input, a.column, 'groupBy.error.unknownColumn', `${path}.column`);
    let type: ColumnDef['type'] = 'integer';
    if (source && (a.fn === 'sum' || a.fn === 'avg' || a.fn === 'min' || a.fn === 'max')) {
      const ok =
        a.fn === 'sum' || a.fn === 'avg' ? NUMERIC.has(source.type) : ORDERED.has(source.type);
      if (!ok) {
        throw configError('groupBy.error.fnNotForType', `${path}.fn`, {
          fn: a.fn,
          column: source.key,
          type: source.type,
        });
      }
      type = a.fn === 'avg' ? 'decimal' : source.type;
    }
    const def: ColumnDef = { key: a.key, type, title: a.title ?? a.key };
    if ((a.fn === 'sum' || a.fn === 'min' || a.fn === 'max') && source?.numFmt) {
      def.numFmt = source.numFmt;
    }
    columns.push(def);
    return { key: a.key, fn: a.fn, ...(source ? { source } : {}) };
  });
  return { by, aggs, columns };
}

/** Value of a column with blank strings as NULL (blanks are ignored / grouped together). */
function value(col: ColumnDef): string {
  const x = q(col.key);
  return col.type === 'string' ? `CASE WHEN ${isBlank(x, 'string')} THEN NULL ELSE ${x} END` : x;
}

const SUM_KEY = (i: number) => `hr$avg_sum_${i}`;
const COUNT_KEY = (i: number) => `hr$avg_count_${i}`;

/** `transform.groupBy` (spec §12.1.6). DuckDB; `avg` is finished in TS with big.js. */
export const transformGroupByPlugin: NodePlugin<GroupByConfig> = {
  type: 'transform.groupBy',
  configSchema: GroupByConfigSchema,
  inputs: [{ name: IN_PORT, required: true }],
  outputs: [{ name: OUT_PORT, required: false }],
  inferSchema(config, inputs) {
    return { [OUT_PORT]: planGroupBy(config, inputs[IN_PORT] ?? []).columns };
  },
  runSql(config, inputs, ctx) {
    const input = inputs[IN_PORT]!;
    const plan = planGroupBy(config, input.columns);
    const hasAvg = plan.aggs.some((a) => a.fn === 'avg');
    const list: string[] = plan.by.map((c) => `${value(c)} AS ${q(c.key)}`);
    const hidden: ColumnDef[] = [];
    plan.aggs.forEach((a, i) => {
      const v = a.source ? value(a.source) : '';
      const key = q(a.key);
      switch (a.fn) {
        case 'sum':
          // SUM of only blanks = 0, like Excel.
          list.push(`coalesce(sum(${v}), 0) AS ${key}`);
          break;
        case 'avg':
          list.push(
            `CAST(NULL AS DECIMAL(38,10)) AS ${key}`,
            `sum(${v}) AS ${q(SUM_KEY(i))}`,
            `count(${v}) AS ${q(COUNT_KEY(i))}`,
          );
          hidden.push({ key: SUM_KEY(i), type: 'decimal' }, { key: COUNT_KEY(i), type: 'integer' });
          break;
        case 'min':
          list.push(`min(${v}) AS ${key}`);
          break;
        case 'max':
          list.push(`max(${v}) AS ${key}`);
          break;
        case 'count':
          list.push(`count(${v}) AS ${key}`);
          break;
        case 'countDistinct':
          list.push(`count(DISTINCT ${v}) AS ${key}`);
          break;
        case 'countRows':
          list.push(`count(*) AS ${key}`);
          break;
      }
    });
    // Groups in order of first appearance; `by` empty → exactly one row, even for 0 input rows.
    list.push(`coalesce(min(${ORD}), 0) AS ${ORD}`);
    const groupBy = plan.by.length > 0 ? ` GROUP BY ${plan.by.map(value).join(', ')}` : '';
    const sql = `SELECT ${list.join(', ')} FROM ${qName(input.name)}${groupBy}`;
    const rel = ctx.sql.derive([input], [...plan.columns, ...hidden], sql, []);
    if (!hasAvg) return { [OUT_PORT]: rel };

    // avg = SUM / COUNT from DuckDB, divided exactly with big.js (never through DOUBLE).
    const table = ctx.sql.fetch(rel);
    for (const row of table.rows) {
      plan.aggs.forEach((a, i) => {
        if (a.fn !== 'avg') return;
        const sum = row[SUM_KEY(i)];
        const count = row[COUNT_KEY(i)];
        row[a.key] =
          typeof count === 'number' && count > 0 && sum !== null && sum !== undefined
            ? new Big(new AvgBig(decimalFrom(sum as Decimal | number)).div(count).toFixed())
            : null;
        delete row[SUM_KEY(i)];
        delete row[COUNT_KEY(i)];
      });
    }
    const outRows: Row[] = table.rows;
    // `fetch` turned an integer SUM beyond 2^53 into decimal: keep its column types.
    const columns = table.columns.filter((c) => plan.columns.some((p) => p.key === c.key));
    return { [OUT_PORT]: { columns, rows: outRows } };
  },
};

import type { DataType } from '@hrflow/flow-schema';
import { FUNCTION_BY_NAME, LOOKUP_FUNCTIONS } from './functions';
import { FormulaError, parseFormula, type Ast } from './parser';
import { resolveRef, type RefColumn } from './refs';

/**
 * Transpiler of `transform.formula` (spec §12.2): Excel formula → SQL DuckDB, from a whitelist of
 * functions only. Pure TS (no DuckDB), shared by the engine and the Designer.
 *
 * Every expression compiles to a pair of SQL expressions: its value `v` and its error code `e`
 * (NULL = no error; '#DIV/0!', '#VALUE!', '#NUM!', '#N/A'), so a bad row never stops DuckDB and
 * IFERROR / `onError` work per row. Numbers are DECIMAL(38,10) throughout (no DOUBLE, except the
 * documented non-integer `^`); multiplication and division use exact macros (`hrflow_fx_*`,
 * engine/duckdb/db.ts). A blank cell is NULL; it becomes 0 / "" / FALSE where a value is needed.
 *
 * Security: the only text taken from the formula into SQL are column keys checked against
 * `IdentifierSchema` (quoted). Every constant (number, string) and every `PARAM` is a bound value
 * placed once in the innermost projection; the SQL holds a placeholder for it.
 *
 * Subexpressions that are used more than once are computed once into a hidden column
 * (`hr$f<n>`) of an inner projection, so the SQL grows linearly with the formula.
 */

/** Placeholder of a bound value in generated SQL (replaced by `?` to run, `$n` to display). */
export const PARAM_MARK = '\u0000?';

export type FType = 'number' | 'string' | 'boolean' | 'date';

type ErrCode = '#DIV/0!' | '#VALUE!' | '#NUM!' | '#N/A';
export const ERROR_CODES: ErrCode[] = ['#DIV/0!', '#VALUE!', '#NUM!', '#N/A'];

interface Ex {
  t: FType;
  /** SQL value; NULL only when `blank` (a blank cell) or when `e` is set. */
  v: string;
  /** SQL error code, `null` = can never fail. */
  e: string | null;
  blank: boolean;
  /** A bare column reference (SUM/MIN/MAX/AND/OR ignore text in references, like Excel). */
  ref: boolean;
  /** Cheap to repeat in SQL (column, hidden column, code constant). */
  simple: boolean;
  /** Deepest projection level of the hidden columns it reads. */
  lvl: number;
  /** Compile-time value of a number constant (structure only, e.g. the exponent of `^`). */
  num?: number;
}

/** A value bound to the innermost projection, in placeholder order. */
export type Binding =
  { kind: 'const'; value: string | null } | { kind: 'param'; key: string; type: ParamType };

export type ParamType = 'string' | 'number' | 'date' | 'month' | 'boolean' | 'select';

export interface FormulaParamDef {
  key: string;
  type: ParamType;
}

export interface FormulaColumnConfig {
  key: string;
  title?: string;
  formula: string;
  type?: 'auto' | 'string' | 'integer' | 'decimal' | 'boolean' | 'date';
  onError?: 'blank' | 'fail';
}

export interface InputColumn {
  key: string;
  title?: string;
  type: DataType;
}

export interface CompiledColumn {
  index: number;
  key: string;
  title: string;
  type: DataType;
  inferred: FType;
  mixedTypes: boolean;
  onError: 'blank' | 'fail';
  /** Hidden column holding the final value / error code, `err` null = cannot fail. */
  value: string;
  err: string | null;
  overwrites: boolean;
}

export interface CompiledFormula {
  columns: CompiledColumn[];
  /** Output schema: input columns (overwritten ones replaced in place), then new columns. */
  output: InputColumn[];
  bindings: Binding[];
  /** SELECT over `from`; adds `ORD` and, with `withErrors`, one error column per column. */
  sql(from: string, ord: string, withErrors: boolean): string;
}

/** Error of column `index` (config path for the Designer). */
export class FormulaColumnError extends Error {
  constructor(
    readonly index: number,
    readonly field: 'key' | 'formula' | 'type',
    readonly error: FormulaError,
  ) {
    super(error.messageKey);
    this.name = 'FormulaColumnError';
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const D = 'DECIMAL(38,10)';
const ZERO = `CAST(0 AS ${D})`;
const ONE = `CAST(1 AS ${D})`;
const NULLS: Record<FType, string> = {
  number: `CAST(NULL AS ${D})`,
  string: 'CAST(NULL AS VARCHAR)',
  boolean: 'CAST(NULL AS BOOLEAN)',
  date: 'CAST(NULL AS DATE)',
};

function quote(key: string): string {
  if (!IDENTIFIER.test(key) && !/^hr\$[a-z0-9_]+$/.test(key)) throw new Error('not an identifier');
  return `"${key}"`;
}

const errLit = (c: ErrCode) => `'${c}'`;
const SIMPLE_ERR = /^('[^']*'|"hr\$[a-z0-9_]+")$/;

function at(node: Ast, key: string, params: Record<string, unknown> = {}): FormulaError {
  return new FormulaError(key, params, node.pos, node.end);
}

function fType(t: DataType): FType {
  if (t === 'integer' || t === 'decimal') return 'number';
  if (t === 'datetime') return 'date';
  return t;
}

/** Output type of `auto`. */
function autoType(t: FType): DataType {
  return t === 'number' ? 'decimal' : t;
}

/** Which result types an explicit column type accepts (spec §12.2 "typeMismatch"). */
const ACCEPTS: Record<string, FType[]> = {
  decimal: ['number', 'string', 'boolean', 'date'],
  integer: ['number', 'string', 'boolean', 'date'],
  string: ['number', 'string', 'boolean', 'date'],
  boolean: ['boolean'],
  date: ['date'],
};

interface Scope {
  /** Columns visible by key/title for reference resolution. */
  refs: RefColumn[];
  /** Ex of a column key. */
  get(key: string): Ex;
  /** Keys defined further down in the node (forward references). */
  later: RefColumn[];
}

class Compiler {
  private readonly stages: string[][] = [];
  readonly bindings: Binding[] = [];
  private n = 0;
  private readonly levels = new Map<string, number>();
  /** Set when an IF/IFS/SWITCH/IFERROR mixes result types (warning `mixedTypes`). */
  mixed = false;

  constructor(private readonly params: readonly FormulaParamDef[]) {}

  /** Store `sql` in a hidden column computed at level `lvl + 1`. */
  temp(sql: string, lvl: number): { ref: string; lvl: number } {
    const name = `hr$f${++this.n}`;
    const stage = lvl + 1;
    while (this.stages.length <= stage) this.stages.push([]);
    this.stages[stage]!.push(`${sql} AS "${name}"`);
    this.levels.set(`"${name}"`, stage);
    return { ref: `"${name}"`, lvl: stage };
  }

  /** Deepest hidden column read by `sql` (0 = input columns only). */
  levelOf(sql: string): number {
    let max = 0;
    for (const m of sql.matchAll(/"hr\$f\d+"/g)) max = Math.max(max, this.levels.get(m[0]) ?? 0);
    return max;
  }

  /** A bound value (innermost projection). */
  bind(b: Binding, cast: string): { ref: string; lvl: number } {
    this.bindings.push(b);
    return this.temp(cast.replace('?', PARAM_MARK), 0);
  }

  /** Make `x` cheap to repeat: hoist its value / error into hidden columns. */
  share(x: Ex): Ex {
    if (x.simple && (x.e === null || SIMPLE_ERR.test(x.e))) return x;
    const v = x.simple ? { ref: x.v, lvl: x.lvl } : this.temp(x.v, x.lvl);
    const e = x.e === null || SIMPLE_ERR.test(x.e) ? { ref: x.e, lvl: 0 } : this.temp(x.e, x.lvl);
    return { ...x, v: v.ref, e: e.ref, simple: true, lvl: Math.max(v.lvl, e.lvl) };
  }

  /** Assemble the nested projections. */
  assemble(from: string, final: string): string {
    let sql = `SELECT * FROM ${from}`;
    this.stages.forEach((cols, k) => {
      if (k === 0 || cols.length === 0) return;
      sql = `SELECT *, ${cols.join(', ')} FROM (${sql}) AS "hr$s${k}"`;
    });
    return `SELECT ${final} FROM (${sql}) AS "hr$s"`;
  }

  // ---- helpers ----------------------------------------------------------------------------

  ex(t: FType, v: string, deps: Ex[], e: (string | null)[] = [], blank = false): Ex {
    return {
      t,
      v,
      e: errs(...deps.map((d) => d.e), ...e),
      blank,
      ref: false,
      simple: false,
      lvl: lvlOf(deps),
    };
  }

  /** `x` whose value is NULL exactly when it failed with `code` (hoisted). */
  checked(t: FType, v: string, deps: Ex[], code: ErrCode, pre: (string | null)[] = []): Ex {
    const h = this.temp(v, lvlOf(deps));
    return {
      t,
      v: h.ref,
      e: errs(
        ...deps.map((d) => d.e),
        ...pre,
        `CASE WHEN ${h.ref} IS NULL THEN ${errLit(code)} END`,
      ),
      blank: false,
      ref: false,
      simple: true,
      lvl: h.lvl,
    };
  }

  constNum(n: number): Ex {
    return {
      t: 'number',
      v: `CAST(${n} AS ${D})`,
      e: null,
      blank: false,
      ref: false,
      simple: true,
      lvl: 0,
      num: n,
    };
  }

  // ---- coercions (Excel implicit conversion, spec §12.2 "Chuyển kiểu ngầm") -----------------

  toNum(x: Ex): Ex {
    switch (x.t) {
      case 'number':
        return x.blank ? { ...x, v: `COALESCE(${x.v}, ${ZERO})`, blank: false, ref: false } : x;
      case 'boolean':
        return {
          ...x,
          v: `CASE WHEN ${x.v} THEN ${ONE} ELSE ${ZERO} END`,
          blank: false,
          ref: false,
        };
      case 'date':
        return {
          ...x,
          v: `COALESCE(CAST(hrflow_fx_serial(${x.v}) AS ${D}), ${ZERO})`,
          blank: false,
          ref: false,
          num: undefined,
        };
      case 'string': {
        const s = this.share(x);
        const parsed = this.temp(`hrflow_fx_num(${s.v})`, s.lvl);
        const present = s.ref ? `NOT hrflow_blank(${s.v})` : `${s.v} IS NOT NULL`;
        return {
          t: 'number',
          v: `COALESCE(${parsed.ref}, ${ZERO})`,
          e: errs(s.e, `CASE WHEN ${present} AND ${parsed.ref} IS NULL THEN '#VALUE!' END`),
          blank: false,
          ref: false,
          simple: true,
          lvl: parsed.lvl,
        };
      }
    }
  }

  toStr(x: Ex): Ex {
    const base = { ...x, t: 'string' as const, blank: false, ref: false, num: undefined };
    switch (x.t) {
      case 'string':
        return x.blank ? { ...base, v: `COALESCE(${x.v}, '')` } : base;
      case 'number':
        return { ...base, v: `COALESCE(hrflow_fx_text(${x.v}), '')`, simple: false };
      case 'boolean':
        return {
          ...base,
          v: `CASE WHEN ${x.v} THEN 'TRUE' WHEN NOT ${x.v} THEN 'FALSE' ELSE '' END`,
          simple: false,
        };
      case 'date':
        return {
          ...base,
          v: `COALESCE(CAST(hrflow_fx_serial(${x.v}) AS VARCHAR), '')`,
          simple: false,
        };
    }
  }

  toBool(x: Ex): Ex {
    const base = { ...x, t: 'boolean' as const, blank: false, ref: false, num: undefined };
    switch (x.t) {
      case 'boolean':
        return x.blank ? { ...base, v: `COALESCE(${x.v}, FALSE)` } : base;
      case 'number':
        return { ...base, v: `(COALESCE(${x.v}, 0) <> 0)`, simple: false };
      case 'date':
        return { ...base, v: `(${x.v} IS NOT NULL)`, simple: false };
      case 'string': {
        const s = this.share(x);
        const b = `CASE WHEN upper(trim(${s.v})) = 'TRUE' THEN TRUE WHEN upper(trim(${s.v})) = 'FALSE' THEN FALSE END`;
        const present = s.ref ? `NOT hrflow_blank(${s.v})` : `${s.v} IS NOT NULL`;
        return {
          ...base,
          v: `COALESCE(${b}, FALSE)`,
          e: errs(s.e, `CASE WHEN ${present} AND ${b} IS NULL THEN '#VALUE!' END`),
          simple: false,
          lvl: s.lvl,
        };
      }
    }
  }

  /** Date argument: a date, or a serial number (1900 date system). */
  toDate(x: Ex): Ex {
    if (x.t === 'date') {
      return x.blank
        ? { ...x, v: `COALESCE(${x.v}, DATE '1899-12-31')`, blank: false, ref: false }
        : x;
    }
    if (x.t === 'boolean') return this.ex('date', NULLS.date, [x], [errLit('#VALUE!')]);
    const n = this.share(this.toNum(x));
    return this.checked('date', `hrflow_fx_date(${n.v})`, [n], '#NUM!');
  }

  /** Integer argument (truncated toward zero, like Excel), as BIGINT. */
  toInt(x: Ex): Ex {
    const n = this.toNum(x);
    return {
      ...n,
      v: `CAST(trunc(greatest(least(${n.v}, 1000000000000000), -1000000000000000)) AS BIGINT)`,
      simple: false,
      num: n.num !== undefined ? Math.trunc(n.num) : undefined,
    };
  }

  /** Same result type for IF/IFS/SWITCH/IFERROR branches; mixed → string (+ warning). */
  unify(xs: Ex[]): Ex[] {
    const t = xs[0]!.t;
    if (xs.every((x) => x.t === t)) return xs;
    this.mixed = true;
    return xs.map((x) => this.toStr(x));
  }

  // ---- compile ---------------------------------------------------------------------------

  compile(node: Ast, scope: Scope): Ex {
    switch (node.k) {
      case 'num': {
        const value = Number(node.text);
        const text = canonicalDecimal(node.text);
        if (text === null) return { ...this.constNum(0), e: errLit('#NUM!'), num: undefined };
        const b = this.bind({ kind: 'const', value: text }, `CAST(? AS ${D})`);
        return {
          t: 'number',
          v: b.ref,
          e: null,
          blank: false,
          ref: false,
          simple: true,
          lvl: b.lvl,
          num: value,
        };
      }
      case 'str': {
        const b = this.bind({ kind: 'const', value: node.value }, 'CAST(? AS VARCHAR)');
        return {
          t: 'string',
          v: b.ref,
          e: null,
          blank: false,
          ref: false,
          simple: true,
          lvl: b.lvl,
        };
      }
      case 'bool':
        return {
          t: 'boolean',
          v: node.value ? 'TRUE' : 'FALSE',
          e: null,
          blank: false,
          ref: false,
          simple: true,
          lvl: 0,
        };
      case 'ref':
        return this.ref(node, scope);
      case 'unary': {
        const x = this.compile(node.arg, scope);
        if (node.op === '+') return x;
        const n = this.toNum(x);
        return {
          ...n,
          v: `(-${n.v})`,
          simple: false,
          num: n.num !== undefined ? -n.num : undefined,
        };
      }
      case 'pct': {
        const n = this.share(this.toNum(this.compile(node.arg, scope)));
        return { ...this.ex('number', `hrflow_fx_mul(${n.v}, CAST(0.01 AS ${D}))`, [n]) };
      }
      case 'bin':
        return this.binary(node, scope);
      case 'call':
        return this.call(node, scope);
    }
  }

  private ref(node: Extract<Ast, { k: 'ref' }>, scope: Scope): Ex {
    const r = resolveRef(node.name, scope.refs);
    if (r.kind === 'ok') return scope.get(r.key);
    if (r.kind === 'ambiguous')
      throw at(node, 'formula.error.ambiguousTitle', { column: node.name });
    if (resolveRef(node.name, scope.later).kind !== 'missing') {
      throw at(node, 'formula.error.forwardReference', { column: node.name });
    }
    throw at(node, 'formula.error.unknownColumn', { column: node.name });
  }

  private binary(node: Extract<Ast, { k: 'bin' }>, scope: Scope): Ex {
    switch (node.op) {
      case '+':
      case '-':
        return this.additive(node, scope);
      case '*':
        return this.mul(this.compile(node.left, scope), this.compile(node.right, scope));
      case '/':
        return this.div(this.compile(node.left, scope), this.compile(node.right, scope));
      case '^':
        return this.pow(this.compile(node.left, scope), this.compile(node.right, scope));
      case '&': {
        const parts: Ast[] = [];
        flatten(node, '&', parts);
        const xs = parts.map((p) => this.toStr(this.compile(p, scope)));
        return this.ex('string', `(${xs.map((x) => x.v).join(' || ')})`, xs);
      }
      default:
        return this.compare(
          node.op,
          this.compile(node.left, scope),
          this.compile(node.right, scope),
        );
    }
  }

  /** `a + b - c …` in one checked sum (overflow → #NUM!). Dates: date ± days → date. */
  private additive(node: Ast, scope: Scope): Ex {
    const terms: { sign: 1 | -1; x: Ex }[] = [];
    const walk = (a: Ast, sign: 1 | -1) => {
      if (a.k === 'bin' && (a.op === '+' || a.op === '-')) {
        walk(a.left, sign);
        walk(a.right, a.op === '-' ? (-sign as 1 | -1) : sign);
      } else terms.push({ sign, x: this.compile(a, scope) });
    };
    walk(node, 1);
    const plusDates = terms.filter((t) => t.x.t === 'date' && t.sign === 1).length;
    const minusDates = terms.filter((t) => t.x.t === 'date' && t.sign === -1).length;
    const nums = terms.map((t) => ({ sign: t.sign, x: this.toNum(t.x) }));
    const sum = nums
      .map((t, i) => `${i === 0 ? (t.sign < 0 ? '-' : '') : t.sign < 0 ? ' - ' : ' + '}${t.x.v}`)
      .join('');
    const total = this.checked(
      'number',
      `TRY(CAST(${sum} AS ${D}))`,
      nums.map((t) => t.x),
      '#NUM!',
    );
    if (plusDates === 1 && minusDates === 0) return this.toDate(total);
    return total;
  }

  mul(a: Ex, b: Ex): Ex {
    const x = this.share(this.toNum(a));
    const y = this.share(this.toNum(b));
    return this.checked('number', `hrflow_fx_mul(${x.v}, ${y.v})`, [x, y], '#NUM!');
  }

  div(a: Ex, b: Ex): Ex {
    const x = this.share(this.toNum(a));
    const y = this.share(this.toNum(b));
    // Fast exact path for |value| < 10^17 (scaled integers computed once, one HUGEINT division);
    // larger values use the general macro.
    const scaled = (z: Ex) =>
      this.temp(
        `CASE WHEN abs(${z.v}) < 100000000000000000 THEN CAST(${z.v} * 10000000000 AS HUGEINT) END`,
        z.lvl,
      );
    const sx = scaled(x);
    const sy = scaled(y);
    return this.checked(
      'number',
      `CASE WHEN ${y.v} = 0 THEN NULL WHEN ${sx.ref} IS NOT NULL AND ${sy.ref} IS NOT NULL THEN hrflow_fx_qdiv(${sx.ref}, ${sy.ref}) ELSE hrflow_fx_div(${x.v}, ${y.v}) END`,
      [x, y, { ...x, lvl: Math.max(sx.lvl, sy.lvl) }],
      '#NUM!',
      [`CASE WHEN ${y.v} = 0 THEN '#DIV/0!' END`],
    );
  }

  /** Integer exponent (constant, |n| ≤ 64): exact; otherwise 15 significant digits (§12.2). */
  private pow(a: Ex, b: Ex): Ex {
    const base = this.share(this.toNum(a));
    const exp = this.toNum(b);
    const n = exp.num;
    if (n !== undefined && Number.isInteger(n) && Math.abs(n) <= 64) {
      if (n === 0) {
        return this.ex('number', ONE, [base], [`CASE WHEN ${base.v} = 0 THEN '#NUM!' END`]);
      }
      let result: Ex | null = null;
      let sq: Ex = base;
      for (let k = Math.abs(n); k > 0; k >>= 1) {
        if (k & 1) result = result ? this.mul(result, sq) : sq;
        if (k > 1) sq = this.mul(sq, sq);
      }
      return n < 0 ? this.div(this.constNum(1), result!) : result!;
    }
    const e = this.share(exp);
    return this.checked(
      'number',
      `CASE WHEN ${base.v} = 0 AND ${e.v} < 0 THEN NULL ELSE TRY_CAST(printf('%.15g', pow(CAST(${base.v} AS DOUBLE), CAST(${e.v} AS DOUBLE))) AS ${D}) END`,
      [base, e],
      '#NUM!',
      [`CASE WHEN ${base.v} = 0 AND ${e.v} < 0 THEN '#DIV/0!' END`],
    );
  }

  /** Excel comparison: numbers < text < logicals; text case-insensitive; blank = 0/""/FALSE. */
  compare(op: string, l: Ex, r: Ex): Ex {
    const cat = (x: Ex) => (x.t === 'date' ? 'number' : x.t);
    const sqlOp = op === '<>' ? '<>' : op;
    const same = (a: Ex, b: Ex): string => {
      if (a.t === 'date' && b.t === 'date') {
        return `(${this.toDate(a).v} ${sqlOp} ${this.toDate(b).v})`;
      }
      switch (cat(a)) {
        case 'number':
          return `(${this.toNum(a).v} ${sqlOp} ${this.toNum(b).v})`;
        case 'string':
          return `(lower(${this.toStr(a).v}) ${sqlOp} lower(${this.toStr(b).v}))`;
        default:
          return `(${this.toBool(a).v} ${sqlOp} ${this.toBool(b).v})`;
      }
    };
    if (cat(l) === cat(r)) {
      const a = l.t === 'string' && !l.simple ? this.share(l) : l;
      const b = r.t === 'string' && !r.simple ? this.share(r) : r;
      return this.ex('boolean', same(a, b), [a, b]);
    }
    const rank = { number: 0, string: 1, boolean: 2 } as const;
    const lr = rank[cat(l)];
    const rr = rank[cat(r)];
    const constant = {
      '=': false,
      '<>': true,
      '<': lr < rr,
      '<=': lr < rr,
      '>': lr > rr,
      '>=': lr > rr,
    }[op]!;
    if (!l.blank && !r.blank) return this.ex('boolean', constant ? 'TRUE' : 'FALSE', [l, r]);
    const a = this.share(l);
    const b = this.share(r);
    const blankLike = (x: Ex, other: Ex): Ex => ({
      ...other,
      v: NULLS[other.t],
      e: null,
      blank: true,
      ref: false,
      simple: true,
      lvl: 0,
      num: undefined,
    });
    const parts: string[] = [];
    const eq = op === '=' || op === '<=' || op === '>=';
    if (a.blank && b.blank) parts.push(`WHEN ${a.v} IS NULL AND ${b.v} IS NULL THEN ${eq}`);
    if (a.blank) parts.push(`WHEN ${a.v} IS NULL THEN ${same(blankLike(a, b), b)}`);
    if (b.blank) parts.push(`WHEN ${b.v} IS NULL THEN ${same(a, blankLike(b, a))}`);
    return this.ex('boolean', `CASE ${parts.join(' ')} ELSE ${constant} END`, [a, b]);
  }

  // ---- functions -------------------------------------------------------------------------

  private call(node: Extract<Ast, { k: 'call' }>, scope: Scope): Ex {
    const spec = FUNCTION_BY_NAME.get(node.name);
    if (!spec) {
      throw new FormulaError(
        'formula.error.unknownFunction',
        { fn: node.name, context: LOOKUP_FUNCTIONS.has(node.name) ? 'lookup' : 'other' },
        node.pos,
        node.nameEnd,
      );
    }
    const argc = node.args.length;
    const badCount =
      argc < spec.min ||
      argc > spec.max ||
      (node.name === 'IFS' && argc % 2 !== 0) ||
      (node.name === 'SWITCH' && argc < 3);
    if (badCount) {
      throw new FormulaError(
        'formula.error.argCount',
        { fn: node.name, min: spec.min, max: spec.max >= 252 ? '…' : spec.max },
        node.pos,
        node.end,
      );
    }
    if (node.name === 'PARAM') return this.param(node);
    const args = node.args;
    const c = (i: number) => this.compile(args[i]!, scope);
    switch (node.name) {
      case 'IF': {
        const cond = this.share(this.toBool(c(0)));
        const [x, y] = this.unify([c(1), args[2] ? c(2) : this.bool(false)]);
        return this.branch([[cond, x!]], y!);
      }
      case 'IFS': {
        const pairs: [Ex, Ex][] = [];
        for (let i = 0; i < argc; i += 2) pairs.push([this.share(this.toBool(c(i))), c(i + 1)]);
        const values = this.unify(pairs.map((p) => p[1]));
        return this.branch(
          pairs.map((p, i) => [p[0], values[i]!]),
          null,
        );
      }
      case 'SWITCH': {
        const x = this.share(c(0));
        const hasDefault = (argc - 1) % 2 === 1;
        const pairs: [Ex, Ex][] = [];
        for (let i = 1; i + 1 < argc; i += 2) {
          pairs.push([this.share(this.compare('=', x, c(i))), c(i + 1)]);
        }
        const values = this.unify([
          ...pairs.map((p) => p[1]),
          ...(hasDefault ? [c(argc - 1)] : []),
        ]);
        return this.branch(
          pairs.map((p, i) => [p[0], values[i]!]),
          hasDefault ? values[values.length - 1]! : null,
        );
      }
      case 'AND':
      case 'OR':
        return this.andOr(
          node.name,
          args.map((_, i) => c(i)),
        );
      case 'NOT': {
        const b = this.toBool(c(0));
        return this.ex('boolean', `(NOT ${b.v})`, [b]);
      }
      case 'IFERROR': {
        const x = c(0);
        if (x.e === null) return x;
        const [vx, alt] = this.unify([x, c(1)]);
        const e = this.share({ ...vx!, v: 'NULL', simple: true });
        const lvl = lvlOf([vx!, alt!, e]);
        return {
          t: vx!.t,
          v: `CASE WHEN ${e.e} IS NOT NULL THEN ${alt!.v} ELSE ${vx!.v} END`,
          e: alt!.e === null ? null : `CASE WHEN ${e.e} IS NOT NULL THEN ${alt!.e} END`,
          blank: vx!.blank || alt!.blank,
          ref: false,
          simple: false,
          lvl,
        };
      }
      case 'ISBLANK': {
        const x = c(0);
        if (!x.blank) return this.bool(false);
        const blank = x.t === 'string' ? `hrflow_blank(${x.v})` : `(${x.v} IS NULL)`;
        return {
          ...this.bool(false),
          v: x.e ? `(${x.e} IS NULL AND ${blank})` : blank,
          simple: false,
          lvl: x.lvl,
        };
      }
      case 'ISNUMBER': {
        const x = c(0);
        if (x.t !== 'number' && x.t !== 'date') return this.bool(false);
        const v = `(${x.v} IS NOT NULL${x.e ? ` AND ${x.e} IS NULL` : ''})`;
        return { ...this.bool(false), v, simple: false, lvl: x.lvl };
      }
      case 'ROUND':
      case 'ROUNDUP':
      case 'ROUNDDOWN': {
        const x = this.share(this.toNum(c(0)));
        const n = this.share(this.toInt(c(1)));
        const mode = { ROUND: 0, ROUNDUP: 1, ROUNDDOWN: 2 }[node.name];
        // The scaled value is computed once (a hidden column), not once per use in the macro.
        const sc = this.temp(`hrflow_fx_s(${x.v})`, x.lvl);
        return this.checked(
          'number',
          `hrflow_fx_round(${x.v}, ${sc.ref}, ${n.v}, ${mode})`,
          [x, n, { ...x, lvl: sc.lvl }],
          '#NUM!',
        );
      }
      case 'INT': {
        const x = this.toNum(c(0));
        return this.ex('number', `CAST(floor(${x.v}) AS ${D})`, [x]);
      }
      case 'ABS': {
        const x = this.toNum(c(0));
        return this.ex('number', `abs(${x.v})`, [x]);
      }
      case 'MIN':
      case 'MAX':
        return this.minMax(
          node.name,
          args.map((_, i) => c(i)),
        );
      case 'MOD': {
        const x = this.share(this.toNum(c(0)));
        const d = this.share(this.toNum(c(1)));
        return this.ex(
          'number',
          `CASE WHEN ${d.v} = 0 THEN NULL ELSE hrflow_fx_mod(${x.v}, ${d.v}) END`,
          [x, d],
          [`CASE WHEN ${d.v} = 0 THEN '#DIV/0!' END`],
        );
      }
      case 'SUM': {
        const xs = args
          .map((_, i) => c(i))
          .map((x) =>
            x.ref && (x.t === 'string' || x.t === 'boolean') ? this.constNum(0) : this.toNum(x),
          );
        return this.checked(
          'number',
          `TRY(CAST(${xs.map((x) => x.v).join(' + ')} AS ${D}))`,
          xs,
          '#NUM!',
        );
      }
      case 'LEFT':
      case 'RIGHT': {
        const s = this.toStr(c(0));
        const n = this.share(args[1] ? this.toInt(c(1)) : intConst(1));
        const fn = node.name === 'LEFT' ? 'left' : 'right';
        return this.ex(
          'string',
          `CASE WHEN ${n.v} < 0 THEN NULL ELSE ${fn}(${s.v}, ${n.v}) END`,
          [s, n],
          [`CASE WHEN ${n.v} < 0 THEN '#VALUE!' END`],
        );
      }
      case 'MID': {
        const s = this.toStr(c(0));
        const st = this.share(this.toInt(c(1)));
        const n = this.share(this.toInt(c(2)));
        const bad = `${st.v} < 1 OR ${n.v} < 0`;
        return this.ex(
          'string',
          `CASE WHEN ${bad} THEN NULL ELSE substring(${s.v}, ${st.v}, ${n.v}) END`,
          [s, st, n],
          [`CASE WHEN ${bad} THEN '#VALUE!' END`],
        );
      }
      case 'LEN': {
        const s = this.toStr(c(0));
        return this.ex('number', `CAST(length(${s.v}) AS ${D})`, [s]);
      }
      case 'TRIM': {
        const s = this.toStr(c(0));
        return this.ex('string', `regexp_replace(trim(${s.v}, ' '), ' {2,}', ' ', 'g')`, [s]);
      }
      case 'UPPER':
      case 'LOWER': {
        const s = this.toStr(c(0));
        return this.ex('string', `${node.name.toLowerCase()}(${s.v})`, [s]);
      }
      case 'PROPER': {
        const s = this.share(this.toStr(c(0)));
        return this.ex('string', `COALESCE(hrflow_fx_proper(${s.v}), '')`, [s]);
      }
      case 'CONCAT': {
        const xs = args.map((_, i) => this.toStr(c(i)));
        return this.ex('string', `(${xs.map((x) => x.v).join(' || ')})`, xs);
      }
      case 'TEXTJOIN': {
        const d = this.share(this.toStr(c(0)));
        const ig = this.toBool(c(1));
        const xs = args.slice(2).map((_, i) => this.share(this.toStr(c(i + 2))));
        const keep = `concat_ws(${d.v}, ${xs.map((x) => x.v).join(', ')})`;
        const skip = `concat_ws(${d.v}, ${xs.map((x) => `NULLIF(${x.v}, '')`).join(', ')})`;
        const v =
          ig.v === 'TRUE'
            ? skip
            : ig.v === 'FALSE'
              ? keep
              : `CASE WHEN ${ig.v} THEN ${skip} ELSE ${keep} END`;
        return this.ex('string', v, [d, ig, ...xs]);
      }
      case 'SUBSTITUTE': {
        const s = this.share(this.toStr(c(0)));
        const o = this.share(this.toStr(c(1)));
        const nw = this.share(this.toStr(c(2)));
        if (!args[3]) {
          return this.ex(
            'string',
            `CASE WHEN ${o.v} = '' THEN ${s.v} ELSE replace(${s.v}, ${o.v}, ${nw.v}) END`,
            [s, o, nw],
          );
        }
        const k = this.share(this.toInt(c(3)));
        return this.ex(
          'string',
          `CASE WHEN ${k.v} < 1 THEN NULL ELSE hrflow_fx_subst(${s.v}, ${o.v}, ${nw.v}, ${k.v}) END`,
          [s, o, nw, k],
          [`CASE WHEN ${k.v} < 1 THEN '#VALUE!' END`],
        );
      }
      case 'FIND':
      case 'SEARCH': {
        const f = this.share(this.toStr(c(0)));
        const w = this.share(this.toStr(c(1)));
        const st = this.share(args[2] ? this.toInt(c(2)) : intConst(1));
        const fn = node.name === 'FIND' ? 'hrflow_fx_find' : 'hrflow_fx_search';
        return this.checked(
          'number',
          `CAST(${fn}(${f.v}, ${w.v}, ${st.v}) AS ${D})`,
          [f, w, st],
          '#VALUE!',
        );
      }
      case 'VALUE': {
        const x = c(0);
        if (x.t === 'boolean') return this.ex('number', ZERO, [x], [errLit('#VALUE!')]);
        return this.toNum(x);
      }
      case 'DATE': {
        const y = this.share(this.toInt(c(0)));
        const m = this.share(this.toInt(c(1)));
        const d = this.share(this.toInt(c(2)));
        return this.checked('date', `hrflow_fx_mkdate(${y.v}, ${m.v}, ${d.v})`, [y, m, d], '#NUM!');
      }
      case 'YEAR':
      case 'MONTH':
      case 'DAY': {
        const d = this.share(this.toDate(c(0)));
        const zero = { YEAR: 1900, MONTH: 1, DAY: 0 }[node.name];
        const fn = node.name.toLowerCase();
        return this.ex(
          'number',
          `CAST(CASE WHEN ${d.v} = DATE '1899-12-31' THEN ${zero} ELSE ${fn}(${d.v}) END AS ${D})`,
          [d],
        );
      }
      case 'EDATE':
      case 'EOMONTH': {
        const d = this.toDate(c(0));
        const m = this.toInt(c(1));
        const shifted = `CAST(${d.v} + to_months(CAST(${m.v} AS INTEGER)) AS DATE)`;
        const v = node.name === 'EDATE' ? shifted : `last_day(${shifted})`;
        return this.checked('date', `hrflow_fx_dok(TRY(${v}))`, [d, m], '#NUM!');
      }
      case 'DATEDIF': {
        const s = this.share(this.toDate(c(0)));
        const e = this.share(this.toDate(c(1)));
        const u = this.share(this.toStr(c(2)));
        return this.checked(
          'number',
          `CAST(hrflow_fx_datedif(${s.v}, ${e.v}, upper(trim(${u.v}))) AS ${D})`,
          [s, e, u],
          '#NUM!',
        );
      }
      case 'WEEKDAY': {
        const d = this.share(this.toDate(c(0)));
        const t = args[1] ? this.share(this.toInt(c(1))) : intConst(1);
        return this.checked(
          'number',
          `CAST(hrflow_fx_weekday(${d.v}, ${t.v}) AS ${D})`,
          [d, t],
          '#NUM!',
        );
      }
    }
    // Every whitelisted function is handled above.
    throw new Error('unhandled function');
  }

  private bool(value: boolean): Ex {
    return {
      t: 'boolean',
      v: value ? 'TRUE' : 'FALSE',
      e: null,
      blank: false,
      ref: false,
      simple: true,
      lvl: 0,
    };
  }

  /** CASE WHEN c1 THEN v1 … ELSE fallback (null → #N/A); errors follow the taken branch. */
  private branch(pairs: [Ex, Ex][], fallback: Ex | null): Ex {
    const all = [...pairs.flat(), ...(fallback ? [fallback] : [])];
    const t = pairs[0]![1].t;
    const vParts = pairs.map(([c, v]) => `WHEN ${c.v} THEN ${v.v}`);
    const eParts: string[] = [];
    for (const [c, v] of pairs) {
      if (c.e) eParts.push(`WHEN ${c.e} IS NOT NULL THEN ${c.e}`);
      eParts.push(`WHEN ${c.v} THEN ${v.e ?? 'NULL'}`);
    }
    const elseErr = fallback ? fallback.e : errLit('#N/A');
    const anyErr = all.some((x) => x.e !== null) || !fallback;
    return {
      t,
      v: `CASE ${vParts.join(' ')} ELSE ${fallback ? fallback.v : NULLS[t]} END`,
      e: anyErr ? `CASE ${eParts.join(' ')} ELSE ${elseErr ?? 'NULL'} END` : null,
      blank: all.some((x) => x.blank) || !fallback,
      ref: false,
      simple: false,
      lvl: lvlOf(all),
    };
  }

  /** AND/OR: blank cells and text in references are ignored; nothing left → #VALUE!. */
  private andOr(fn: 'AND' | 'OR', xs: Ex[]): Ex {
    const parts: Ex[] = [];
    const nullable: Ex[] = [];
    for (const x of xs) {
      if (x.ref && x.t === 'string') continue;
      if (x.blank) {
        const s = this.share(x);
        const b = this.toBool({ ...s, blank: false });
        const p = this.share({ ...b, v: `CASE WHEN ${s.v} IS NULL THEN NULL ELSE ${b.v} END` });
        parts.push(p);
        nullable.push(p);
      } else parts.push(this.toBool(x));
    }
    const ignoredErrs = xs.filter((x) => x.ref && x.t === 'string').map((x) => x.e);
    if (parts.length === 0)
      return this.ex('boolean', 'FALSE', [], [...ignoredErrs, errLit('#VALUE!')]);
    const unit = fn === 'AND' ? 'TRUE' : 'FALSE';
    const v = `(${parts.map((p) => `COALESCE(${p.v}, ${unit})`).join(fn === 'AND' ? ' AND ' : ' OR ')})`;
    const none =
      nullable.length === parts.length
        ? `CASE WHEN ${nullable.map((p) => `${p.v} IS NULL`).join(' AND ')} THEN '#VALUE!' END`
        : null;
    return this.ex('boolean', v, parts, [...ignoredErrs, none]);
  }

  /** MIN/MAX: blanks, text and logicals in references are ignored; nothing left → 0. */
  private minMax(fn: 'MIN' | 'MAX', xs: Ex[]): Ex {
    const kept = xs.filter((x) => !(x.ref && (x.t === 'string' || x.t === 'boolean')));
    const ignoredErrs = xs.filter((x) => !kept.includes(x)).map((x) => x.e);
    const sqlFn = fn === 'MIN' ? 'least' : 'greatest';
    if (kept.length > 0 && kept.every((x) => x.t === 'date')) {
      return {
        ...this.ex('date', `${sqlFn}(${kept.map((x) => x.v).join(', ')})`, kept, ignoredErrs),
        blank: true,
      };
    }
    const nums = kept.map((x) =>
      x.blank && x.ref && x.t === 'number'
        ? x
        : x.t === 'date' && x.ref
          ? this.dateRefNum(x)
          : this.toNum(x),
    );
    if (nums.length === 0) return this.ex('number', ZERO, [], ignoredErrs);
    return this.ex(
      'number',
      `COALESCE(${sqlFn}(${nums.map((x) => x.v).join(', ')}), ${ZERO})`,
      nums,
      ignoredErrs,
    );
  }

  /** A date reference as a serial number, blank stays NULL (ignored by MIN/MAX). */
  private dateRefNum(x: Ex): Ex {
    return { ...x, t: 'number', v: `CAST(hrflow_fx_serial(${x.v}) AS ${D})`, simple: false };
  }

  private param(node: Extract<Ast, { k: 'call' }>): Ex {
    const arg = node.args[0]!;
    if (arg.k !== 'str') throw at(arg, 'formula.error.paramName');
    const def = this.params.find((p) => p.key === arg.value);
    if (!def) throw at(arg, 'formula.error.unknownParam', { param: arg.value });
    const t: FType =
      def.type === 'number'
        ? 'number'
        : def.type === 'boolean'
          ? 'boolean'
          : def.type === 'date' || def.type === 'month'
            ? 'date'
            : 'string';
    const cast = `TRY_CAST(? AS ${t === 'number' ? D : t === 'date' ? 'DATE' : t === 'boolean' ? 'BOOLEAN' : 'VARCHAR'})`;
    const b = this.bind({ kind: 'param', key: def.key, type: def.type }, cast);
    return { t, v: b.ref, e: null, blank: true, ref: false, simple: true, lvl: b.lvl };
  }
}

function intConst(n: number): Ex {
  return {
    t: 'number',
    v: `CAST(${n} AS BIGINT)`,
    e: null,
    blank: false,
    ref: false,
    simple: true,
    lvl: 0,
    num: n,
  };
}

function errs(...es: (string | null | undefined)[]): string | null {
  const list = es.filter((e): e is string => typeof e === 'string' && e !== 'NULL');
  const uniq = [...new Set(list)];
  if (uniq.length === 0) return null;
  return uniq.length === 1 ? uniq[0]! : `COALESCE(${uniq.join(', ')})`;
}

function lvlOf(xs: readonly Ex[]): number {
  return xs.reduce((m, x) => Math.max(m, x.lvl), 0);
}

function flatten(node: Ast, op: string, out: Ast[]): void {
  if (node.k === 'bin' && node.op === op) {
    flatten(node.left, op, out);
    flatten(node.right, op, out);
  } else out.push(node);
}

/** Number literal → plain decimal text with ≤ 10 places (half away from zero); null = overflow. */
export function canonicalDecimal(text: string): string | null {
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) return null;
  let digits = (m[1] ?? '') + (m[2] ?? '');
  let point = (m[1] ?? '').length + Number(m[3] ?? 0);
  digits = digits.replace(/^0+/, () => '');
  const lead = ((m[1] ?? '') + (m[2] ?? '')).length - digits.length;
  point -= lead;
  if (digits === '') return '0';
  if (point > 28) return null;
  // Integer part / fraction from (digits, point).
  let int = point <= 0 ? '0' : digits.slice(0, point).padEnd(point, '0');
  let frac = point < 0 ? '0'.repeat(-point) + digits : digits.slice(Math.max(point, 0));
  if (frac.length > 10) {
    const up = frac[10]! >= '5';
    frac = frac.slice(0, 10);
    if (up) {
      const n = (BigInt(int + frac) + 1n).toString().padStart(int.length + 10, '0');
      int = n.slice(0, n.length - 10);
      frac = n.slice(n.length - 10);
      if (int.replace(/^0+/, '').length > 28) return null;
    }
  }
  frac = frac.replace(/0+$/, '');
  int = int.replace(/^0+(?=\d)/, '');
  return frac ? `${int}.${frac}` : int;
}

export interface CompileOptions {
  params: readonly FormulaParamDef[];
}

/**
 * Compile the columns of a formula node over `input`. Throws `FormulaColumnError` (column index
 * + field + cause) for the first problem.
 */
export function compileFormula(
  columns: readonly FormulaColumnConfig[],
  input: readonly InputColumn[],
  opts: CompileOptions,
): CompiledFormula {
  const comp = new Compiler(opts.params);
  // Visible columns (by key) → current Ex and title.
  const visible = new Map<string, { ex: Ex; title: string }>();
  for (const col of input) {
    const v =
      col.type === 'integer'
        ? `CAST(${quote(col.key)} AS ${D})`
        : col.type === 'datetime'
          ? `CAST(${quote(col.key)} AS DATE)`
          : quote(col.key);
    visible.set(col.key, {
      ex: { t: fType(col.type), v, e: null, blank: true, ref: true, simple: true, lvl: 0 },
      title: col.title ?? col.key,
    });
  }
  const seen = new Set<string>();
  columns.forEach((c, i) => {
    if (seen.has(c.key)) {
      throw new FormulaColumnError(
        i,
        'key',
        new FormulaError('formula.error.duplicateKey', { key: c.key }),
      );
    }
    if (c.key.startsWith('_')) {
      throw new FormulaColumnError(
        i,
        'key',
        new FormulaError('formula.error.reservedKey', { key: c.key }),
      );
    }
    seen.add(c.key);
  });

  const compiled: CompiledColumn[] = [];
  const output: InputColumn[] = input.map((c) => ({ ...c }));
  columns.forEach((cfg, i) => {
    const refs: RefColumn[] = [...visible.entries()].map(([key, v]) => ({ key, title: v.title }));
    const later: RefColumn[] = columns
      .slice(i)
      .filter((c) => !visible.has(c.key))
      .map((c) => ({ key: c.key, title: c.title ?? c.key }));
    const scope: Scope = { refs, later, get: (key) => visible.get(key)!.ex };
    comp.mixed = false;
    let ex: Ex;
    try {
      ex = comp.compile(parseFormula(cfg.formula), scope);
    } catch (err) {
      if (err instanceof FormulaError) throw new FormulaColumnError(i, 'formula', err);
      throw err;
    }
    const inferred = ex.t;
    const wanted = cfg.type ?? 'auto';
    const type: DataType = wanted === 'auto' ? autoType(inferred) : wanted;
    if (!ACCEPTS[type]!.includes(inferred)) {
      throw new FormulaColumnError(
        i,
        'type',
        new FormulaError('formula.error.typeMismatch', {
          column: cfg.key,
          type,
          inferred: autoType(inferred),
        }),
      );
    }
    const fin = finalize(comp, ex, type);
    let value: string;
    let err: string | null = null;
    if (fin.e === null) {
      value = fin.simple ? fin.v : comp.temp(fin.v, fin.lvl).ref;
    } else {
      const e = comp.temp(fin.e, fin.lvl);
      const v = comp.temp(`CASE WHEN ${e.ref} IS NULL THEN ${fin.v} END`, e.lvl);
      value = v.ref;
      err = e.ref;
    }
    const prev = input.find((c) => c.key === cfg.key);
    const title = cfg.title ?? prev?.title ?? cfg.key;
    const level = comp.levelOf(value);
    const refEx: Ex =
      type === 'integer'
        ? {
            t: 'number',
            v: `CAST(${value} AS ${D})`,
            e: null,
            blank: true,
            ref: true,
            simple: true,
            lvl: level,
          }
        : { t: fType(type), v: value, e: null, blank: true, ref: true, simple: true, lvl: level };
    visible.set(cfg.key, { ex: refEx, title });
    compiled.push({
      index: i,
      key: cfg.key,
      title,
      type,
      inferred,
      mixedTypes: comp.mixed,
      onError: cfg.onError ?? 'blank',
      value,
      err,
      overwrites: prev !== undefined,
    });
    const def: InputColumn = { key: cfg.key, title, type };
    const pos = output.findIndex((c) => c.key === cfg.key);
    if (pos >= 0) output[pos] = def;
    else output.push(def);
  });

  return {
    columns: compiled,
    output,
    bindings: comp.bindings,
    sql(from, ord, withErrors) {
      const byKey = new Map(compiled.map((c) => [c.key, c]));
      const list = output.map((c) => {
        const f = byKey.get(c.key);
        return f ? `${f.value} AS ${quote(c.key)}` : quote(c.key);
      });
      list.push(ord);
      if (withErrors) {
        for (const c of compiled) if (c.err) list.push(`${c.err} AS "hr$err${c.index}"`);
      }
      return comp.assemble(from, list.join(', '));
    },
  };
}

/** Final conversion to the column type; strings: "" is blank. */
function finalize(comp: Compiler, ex: Ex, type: DataType): Ex {
  const keepBlank = (x: Ex, conv: (s: Ex) => Ex): Ex => {
    if (!x.blank) return conv(x);
    const s = comp.share(x);
    const r = conv({ ...s, blank: false });
    return {
      ...r,
      v: `CASE WHEN ${s.v} IS NULL THEN NULL ELSE ${r.v} END`,
      simple: false,
      lvl: Math.max(r.lvl, s.lvl),
    };
  };
  if (type === 'decimal' && ex.t === 'number') return ex;
  if (type === ex.t && type !== 'string') return ex;
  switch (type) {
    case 'string':
      if (ex.t === 'string') return { ...ex, v: `NULLIF(${ex.v}, '')`, simple: false };
      if (ex.t === 'date')
        return keepBlank(ex, (s) => ({
          ...s,
          t: 'string',
          v: `CAST(${s.v} AS VARCHAR)`,
          simple: false,
        }));
      return keepBlank(ex, (s) => {
        const str = comp.toStr(s);
        return { ...str, v: `NULLIF(${str.v}, '')`, simple: false };
      });
    case 'decimal':
      return keepBlank(ex, (s) => comp.toNum(s));
    case 'integer':
      return keepBlank(ex, (s) => {
        const n = comp.share(comp.toNum(s));
        return {
          ...n,
          t: 'number',
          v: `CASE WHEN ${n.v} = trunc(${n.v}) THEN TRY_CAST(${n.v} AS BIGINT) END`,
          e: errs(
            n.e,
            `CASE WHEN ${n.v} <> trunc(${n.v}) THEN '#VALUE!' WHEN TRY_CAST(${n.v} AS BIGINT) IS NULL THEN '#NUM!' END`,
          ),
          simple: false,
        };
      });
    default:
      return ex;
  }
}

/** Generated SQL with placeholders shown as `$1`, `$2`… (Designer "Xem SQL đã sinh"). */
export function displaySql(sql: string): string {
  let n = 0;
  return sql.replaceAll(PARAM_MARK, () => `$${++n}`);
}

/** Generated SQL ready to prepare (`?` placeholders). */
export function runnableSql(sql: string): string {
  return sql.replaceAll(PARAM_MARK, '?');
}

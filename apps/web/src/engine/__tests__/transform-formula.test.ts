import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Big, isDecimal } from '../core/decimal';
import type { Table, Value } from '../core/types';
import { checkDesign } from '../design';
import { compileFormula, displaySql, type InputColumn } from '../formula/compile';
import { parseFormula } from '../formula/parser';
import { toDisplay, toStored } from '../formula/refs';
import { nodeDuckDb } from './duckdb-node';
import { rowsOf, runNode, t, table } from './sql-helpers';

/** `transform.formula` (spec §12.2, AC-B4-01…24). Fake data only. */

const staff = table(
  [
    ['ma_nv', 'string'],
    ['luong', 'decimal'],
    ['cong', 'decimal'],
    ['ngay_vao', 'date'],
    ['ngay_ra', 'date'],
    ['ghi_chu', 'string'],
    ['ghi_chu_2', 'string'],
  ],
  [
    ['NV001', new Big('1234567890123.25'), new Big('22'), '2024-01-31', '2024-03-01', 'a', 'x'],
    ['NV002', new Big('10000000'), new Big('0'), '2025-12-31', null, null, null],
    ['NV003', null, null, null, null, 'Nguyễn', 'y'],
  ],
);
// Titles as in an input slot; two columns share "Ghi chú" (AC-B4-05).
const TITLES: Record<string, string> = {
  ma_nv: 'Mã NV',
  luong: 'Lương cơ bản',
  cong: 'Ngày công',
  ngay_vao: 'Ngày vào',
  ngay_ra: 'Ngày ra',
  ghi_chu: 'Ghi chú',
  ghi_chu_2: 'Ghi chú',
};
for (const c of staff.columns) c.title = TITLES[c.key]!;

const params = [
  { key: 'ky_luong', label: 'Kỳ lương', type: 'month' as const },
  { key: 'he_so', label: 'Hệ số', type: 'number' as const },
];

type Col = { key: string; formula: string; title?: string; type?: string; onError?: string };

async function run(columns: Col[], input: Table = staff, p: Record<string, string | null> = {}) {
  return runNode('transform.formula', { columns }, { in: input }, { paramDefs: params, params: p });
}

const plain = (v: Value | undefined) =>
  v === null || v === undefined ? null : isDecimal(v) ? v.toFixed() : v;

/** Values of column `key` for each row. */
async function values(
  formula: string,
  input: Table = staff,
  p: Record<string, string | null> = {},
) {
  const r = await run([{ key: 'r', formula }], input, p);
  return r.out.out!.rows.map((row) => plain(row.r));
}

const cols = (): InputColumn[] =>
  staff.columns.map((c) => ({ key: c.key, type: c.type, title: c.title! }));
const compile = (formula: string, extra: Partial<Col> = {}) =>
  compileFormula([{ key: 'r', formula, ...extra } as never], cols(), {
    params: params.map((p) => ({ key: p.key, type: p.type })),
  });

function compileError(formula: string): { key: string; params: Record<string, unknown> } {
  try {
    compile(formula);
  } catch (err) {
    const e = err as { error: { messageKey: string; params: Record<string, unknown> } };
    return { key: e.error.messageKey, params: e.error.params };
  }
  throw new Error('no error');
}

describe('design-time errors (AC-B4-02, AC-B4-03)', () => {
  it('unsupported functions: lookups suggest Join, others code.sql', () => {
    expect(compileError('=XLOOKUP([ma_nv],1,2)')).toEqual({
      key: 'formula.error.unknownFunction',
      params: { fn: 'XLOOKUP', context: 'lookup' },
    });
    expect(compileError('=vlookup(1,2,3)').params.context).toBe('lookup');
    expect(compileError('=FOO(1)')).toEqual({
      key: 'formula.error.unknownFunction',
      params: { fn: 'FOO', context: 'other' },
    });
    for (const fn of ['TEXT(1,"0")', 'NETWORKDAYS(1,2)', 'TODAY()', 'IFNA(1,2)']) {
      expect(compileError(`=${fn}`).key).toBe('formula.error.unknownFunction');
    }
  });

  it('syntax errors carry the character position; missing "=" and ";" are syntax errors', () => {
    expect(compileError('=IF([luong]>0,1')).toMatchObject({
      key: 'formula.error.syntax',
      params: { context: 'missingParen', pos: 16 },
    });
    expect(compileError('IF(1,2,3)')).toMatchObject({
      key: 'formula.error.syntax',
      params: { context: 'missingEquals' },
    });
    expect(compileError('=ROUND([luong];2)')).toMatchObject({
      key: 'formula.error.syntax',
      params: { context: 'semicolon', pos: 15 },
    });
    expect(compileError('=A1+1').params.context).toBe('cellRef');
    expect(compileError('="abc').params.context).toBe('unterminatedString');
    expect(compileError('=').params.context).toBe('empty');
    expect(compileError('=1+').params.context).toBe('end');
    expect(compileError('=(1))').params.context).toBe('unbalanced');
  });

  it('wrong argument count → argCount', () => {
    expect(compileError('=ROUND(1)')).toMatchObject({
      key: 'formula.error.argCount',
      params: { fn: 'ROUND' },
    });
    expect(compileError('=IFS(TRUE,1,FALSE)').key).toBe('formula.error.argCount');
    expect(compileError('=NOT(1,2)').key).toBe('formula.error.argCount');
  });

  it('nesting deeper than 64 and formulas longer than 2,000 characters are refused', () => {
    expect(compileError(`=${'('.repeat(65)}1${')'.repeat(65)}`).key).toBe('formula.error.tooDeep');
    expect(() => parseFormula(`=${'('.repeat(64)}1${')'.repeat(64)}`)).not.toThrow();
    expect(compileError(`=${'1+'.repeat(1000)}1`).key).toBe('formula.error.tooLong');
  });

  it('every one of the 41 functions (incl. PARAM) compiles without design error (AC-B4-01)', () => {
    const all = [
      'IF(1,2,3)',
      'IFS(TRUE,1)',
      'AND(TRUE)',
      'OR(FALSE)',
      'NOT(TRUE)',
      'SWITCH(1,1,2)',
      'IFERROR(1,2)',
      'ISBLANK([luong])',
      'ISNUMBER(1)',
      'ROUND(1,2)',
      'ROUNDUP(1,2)',
      'ROUNDDOWN(1,2)',
      'INT(1)',
      'ABS(1)',
      'MIN(1,2)',
      'MAX(1,2)',
      'MOD(1,2)',
      'SUM(1,2)',
      'LEFT("a",1)',
      'RIGHT("a",1)',
      'MID("a",1,1)',
      'LEN("a")',
      'TRIM("a")',
      'UPPER("a")',
      'LOWER("a")',
      'PROPER("a")',
      'CONCAT("a","b")',
      'TEXTJOIN(",",TRUE,"a")',
      'SUBSTITUTE("a","a","b")',
      'FIND("a","a")',
      'SEARCH("a","a")',
      'VALUE("1")',
      'DATE(2026,1,1)',
      'YEAR([ngay_vao])',
      'MONTH([ngay_vao])',
      'DAY([ngay_vao])',
      'EDATE([ngay_vao],1)',
      'EOMONTH([ngay_vao],1)',
      'DATEDIF([ngay_vao],[ngay_ra],"D")',
      'WEEKDAY([ngay_vao])',
      'PARAM("ky_luong")',
    ];
    expect(all).toHaveLength(41);
    for (const f of all) expect(() => compile(`=${f}`), f).not.toThrow();
  });
});

describe('too many chained operations (R1-fix #6)', () => {
  it('a long chain of operations → formula.error.tooComplex at design time', () => {
    expect(compileError(`=${Array(250).fill('[cong]').join('*')}`).key).toBe(
      'formula.error.tooComplex',
    );
    expect(compileError(`=1${'%'.repeat(400)}`).key).toBe('formula.error.tooComplex');
  });

  it('a chain just below the limit still runs, quickly', async () => {
    const t0 = performance.now();
    const v = await values(`=${Array(60).fill('[cong]').join('*')}`);
    expect(v[2]).toBe('0');
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect((await values(`=1${'+1'.repeat(500)}`))[0]).toBe('501');
  });

  it('the limit is per column: 50 chained ROUND/IFERROR columns run (R1-fix2)', async () => {
    const columns = Array.from({ length: 50 }, (_, i) => {
      const prev = i === 0 ? 'luong' : `c${i - 1}`;
      return {
        key: `c${i}`,
        formula: i % 2 ? `=IFERROR([${prev}]/[cong],0)+1` : `=ROUND([${prev}]*1.1/[cong],2)`,
      };
    });
    const t0 = performance.now();
    const r = await run(columns);
    expect(r.out.out!.rows).toHaveLength(3);
    expect(performance.now() - t0).toBeLessThan(20_000);
    // A single column too deep is still refused, on that column.
    try {
      compileFormula(
        [
          { key: 'ok', formula: '=[cong]*2' },
          { key: 'deep', formula: `=${Array(250).fill('[ok]').join('*')}` },
        ],
        cols(),
        { params: [] },
      );
      throw new Error('no error');
    } catch (e) {
      expect((e as { index: number; error: { messageKey: string } }).index).toBe(1);
      expect((e as { error: { messageKey: string } }).error.messageKey).toBe(
        'formula.error.tooComplex',
      );
    }
  });

  it('the same subexpression is computed once', () => {
    const sql = compile('=IF([luong]/[cong]>1,[luong]/[cong],0)').sql('"hr$x"', '"hr$ord"', true);
    expect(sql.match(/hrflow_fx_qdiv/g)).toHaveLength(1);
  });
});

describe('column references (AC-B4-04, AC-B4-05, AC-B4-06)', () => {
  it('[Title] and [key] give the same result; stored form uses the key, shown by title', async () => {
    expect(await values('=[Lương cơ bản]*2')).toEqual(await values('=[luong]*2'));
    const refs = cols().map((c) => ({ key: c.key, title: c.title! }));
    expect(toStored('=[Lương cơ bản]*[ngày CÔNG]+"[luong]"', refs)).toBe(
      '=[luong]*[cong]+"[luong]"',
    );
    expect(toDisplay('=[luong]*[cong]', refs)).toBe('=[Lương cơ bản]*[Ngày công]');
    // Title renamed upstream: the stored formula still runs and is shown with the new title.
    const renamed = refs.map((r) => (r.key === 'luong' ? { ...r, title: 'Lương CB mới' } : r));
    expect(toDisplay('=[luong]', renamed)).toBe('=[Lương CB mới]');
  });

  it('a title shared by 2 columns is ambiguous; the key works; "]]" escapes "]"', async () => {
    expect(compileError('=[Ghi chú]')).toMatchObject({ key: 'formula.error.ambiguousTitle' });
    expect(await values('=[ghi_chu_2]')).toEqual(['x', null, 'y']);
    const refs = cols().map((c) => ({ key: c.key, title: c.title! }));
    expect(toDisplay('=[ghi_chu]', refs)).toBe('=[ghi_chu]');
    const odd = table([['a', 'decimal']], [[new Big(3)]]);
    odd.columns[0]!.title = 'Tỷ lệ [%]';
    expect(await values('=[Tỷ lệ [%]]]*2', odd)).toEqual(['6']);
    expect(toDisplay('=[a]', [{ key: 'a', title: 'Tỷ lệ [%]' }])).toBe('=[Tỷ lệ [%]]]');
  });

  it('later columns use earlier ones; forward references fail; overwrite reads the old value in place', async () => {
    const r = await run([
      { key: 'luong', formula: '=[luong]*1.1' },
      { key: 'thuong', title: 'Thưởng', formula: '=[luong]/10' },
    ]);
    const out = r.out.out!;
    expect(out.columns.map((c) => c.key)).toEqual([...staff.columns.map((c) => c.key), 'thuong']);
    expect(rowsOf(out, ['luong', 'thuong'])[0]).toEqual(['1358024679135.575', '135802467913.5575']);
    expect(out.columns.find((c) => c.key === 'luong')!.title).toBe('Lương cơ bản');
    await expect(
      run([
        { key: 'a', formula: '=[b]+1' },
        { key: 'b', formula: '=1' },
      ]),
    ).rejects.toMatchObject({
      messageKey: 'formula.error.forwardReference',
      params: { path: 'columns.0.formula', column: 'b' },
    });
    await expect(run([{ key: 'r', formula: '=[khong_co]' }])).rejects.toMatchObject({
      messageKey: 'formula.error.unknownColumn',
      nodeId: 'n',
      params: { path: 'columns.0.formula', pos: 2 },
    });
  });
});

describe('semantics (AC-B4-07 … AC-B4-12)', () => {
  const one = table(
    [
      ['a', 'decimal'],
      ['b', 'decimal'],
      ['s', 'string'],
    ],
    [[null, new Big(2), null]],
  );
  const v1 = async (f: string) => (await values(f, one))[0];

  it('blank cells follow Excel (AC-B4-07)', async () => {
    expect(await v1('=[a]+1')).toBe('1');
    expect(await v1('=[s]&"x"')).toBe('x');
    expect(await v1('=ISBLANK([a])')).toBe(true);
    expect(await v1('=[a]=""')).toBe(true);
    expect(await v1('=[a]=0')).toBe(true);
    expect(await v1('=[a]')).toBeNull();
    expect(await v1('=IF(TRUE,[a],0)')).toBeNull();
    expect(await v1('=SUM([a],[b])')).toBe('2');
  });

  it('decimals are exact, DECIMAL(38,10), no DOUBLE in the SQL (AC-B4-08)', async () => {
    expect(await v1('=0.1+0.2')).toBe('0.3');
    expect(await v1('=1/3')).toBe('0.3333333333');
    expect(await v1('=2/3')).toBe('0.6666666667');
    expect(await v1('=-2/3')).toBe('-0.6666666667');
    expect((await values('=[luong]*1.1'))[0]).toBe('1358024679135.575');
    expect(await v1('=10000000000*10000000000')).toBe('100000000000000000000');
    expect(await v1('=123456789012345678.5/0.5')).toBe('246913578024691357');
    const r = await run([{ key: 'r', formula: '=[luong]*1.1/3+[cong]' }]);
    expect(r.out.out!.columns.find((c) => c.key === 'r')!.type).toBe('decimal');
    const sql = displaySql(
      compile('=[luong]*1.1/3+[cong]-ROUND([luong],2)%').sql('"hr$x"', '"hr$ord"', true),
    );
    expect(sql).not.toMatch(/DOUBLE|FLOAT|REAL/);
  });

  it('rounding and MOD like Excel (AC-B4-09)', async () => {
    expect(await v1('=ROUND(2.675,2)')).toBe('2.68');
    expect(await v1('=ROUND(-2.5,0)')).toBe('-3');
    expect(await v1('=ROUNDUP(-1.21,1)')).toBe('-1.3');
    expect(await v1('=ROUNDDOWN(1.29,1)')).toBe('1.2');
    expect(await v1('=INT(-1.5)')).toBe('-2');
    expect(await v1('=MOD(-3,2)')).toBe('1');
    expect(await v1('=ROUND(0.00000000005,10)')).toBe('0.0000000001');
    expect(await v1('=ROUND(12345.678,-28)')).toBe('0');
  });

  it('text functions (AC-B4-10)', async () => {
    expect(await v1('="abc"="ABC"')).toBe(true);
    expect(await v1('=FIND("a","ABa")')).toBe('3');
    expect(await v1('=SEARCH("b*","aBc")')).toBe('2');
    expect(await v1('=SEARCH("(.","x(.y")')).toBe('2');
    expect(await v1('=MID("Nguyễn",2,3)')).toBe('guy');
    expect(await v1('=LEN("Nguyễn")')).toBe('6');
    expect(await v1('=PROPER("nguyễn văn a")')).toBe('Nguyễn Văn A');
    expect(await v1('=TEXTJOIN(", ",TRUE,"a","","b")')).toBe('a, b');
  });

  it('implicit conversion (AC-B4-11)', async () => {
    expect(await v1('="12"+1')).toBe('13');
    expect(await v1('=TRUE+1')).toBe('2');
    expect(await v1('=VALUE("1.5")')).toBe('1.5');
    const r = await run([{ key: 'r', formula: '="abc"+1' }], one);
    expect(r.out.out!.rows[0]!.r).toBeNull();
    expect(r.warnings[0]).toMatchObject({
      messageKey: 'formula.warning.rowErrors',
      params: { error: '#VALUE!' },
    });
  });

  it('dates (AC-B4-12)', async () => {
    const r = await run([
      { key: 'a', formula: '=[ngay_vao]+30' },
      { key: 'b', formula: '=[ngay_ra]-[ngay_vao]' },
      { key: 'c', formula: '=EOMONTH(DATE(2026,2,10),0)' },
      { key: 'd', formula: '=EDATE(DATE(2026,1,31),1)' },
      { key: 'e', formula: '=DATEDIF(DATE(2020,3,15),DATE(2026,3,14),"Y")' },
      { key: 'f', formula: '=WEEKDAY(DATE(2026,10,30),2)' },
      { key: 'g', formula: '=DATE(2026,13,1)' },
    ]);
    const out = r.out.out!;
    expect(out.columns.slice(-7).map((c) => c.type)).toEqual([
      'date',
      'decimal',
      'date',
      'date',
      'decimal',
      'decimal',
      'date',
    ]);
    expect(rowsOf(out, ['a', 'b', 'c', 'd', 'e', 'f', 'g'])[0]).toEqual([
      '2024-03-01',
      '30',
      '2026-02-28',
      '2026-02-28',
      '5',
      '5',
      '2027-01-01',
    ]);
  });
});

describe('exact arithmetic against big.js (fast and wide paths)', () => {
  it('a/b, a*b and ROUND match big.js rounded half away from zero to 10 places', async () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const num = (digits: number) => {
      const int =
        Math.floor(rnd() * 10 ** Math.min(digits, 15)).toString() +
        (digits > 15 ? '0'.repeat(digits - 15) : '');
      const frac = Math.floor(rnd() * 1e10)
        .toString()
        .padStart(10, '0');
      return `${rnd() < 0.5 ? '-' : ''}${int}.${frac}`;
    };
    const pairs: [string, string][] = [
      ['1', '3'],
      ['-2', '3'],
      ['0.0000000001', '3'],
      ['99999999999999999', '0.0000000003'],
      ['123456789012345678.5', '0.5'],
      ['-123456789012345678901234.5', '7'],
      ['0.0000000005', '1'],
      ['5', '-0.0000000002'],
    ];
    for (let i = 0; i < 60; i++) pairs.push([num(1 + (i % 20)), num(1 + ((i * 7) % 17))]);
    const input = table(
      [
        ['a', 'decimal'],
        ['b', 'decimal'],
      ],
      pairs.map(([a, b]) => [new Big(a), new Big(b)]),
    );
    const r = await run(
      [
        { key: 'q', formula: '=[a]/[b]' },
        { key: 'm', formula: '=[a]*[b]' },
        { key: 'r', formula: '=ROUND([a],2)' },
        { key: 'u', formula: '=ROUNDUP([a],-3)' },
      ],
      input,
    );
    const half = 1; // Big.roundHalfUp: half away from zero
    r.out.out!.rows.forEach((row, i) => {
      const [a, b] = pairs[i]!.map((x) => new Big(x)) as [Big, Big];
      const q = a.div(b);
      const m = a.times(b).round(10, half);
      const fits = (x: Big) => x.abs().lt(new Big('1e28'));
      const at = `${pairs[i]![0]} / ${pairs[i]![1]}`;
      if (b.abs().lt(new Big('1e18'))) {
        expect(plain(row.q), at).toBe(fits(q) ? new Big(a).div(b).round(10, half).toFixed() : null);
      }
      expect(plain(row.m), at).toBe(fits(m) ? m.toFixed() : null);
      expect(plain(row.r), at).toBe(a.round(2, half).toFixed());
      const up = a.div(1000).round(0, 3).times(1000);
      expect(plain(row.u), at).toBe(fits(up) ? up.toFixed() : null);
    });
  });
});

describe('params and injection (AC-B4-13, AC-B4-14)', () => {
  it('PARAM month → first day of the month; blank → blank; values are bound, not in the SQL', async () => {
    expect((await values('=PARAM("ky_luong")', staff, { ky_luong: '2026-09' }))[0]).toBe(
      '2026-09-01',
    );
    expect((await values('=PARAM("ky_luong")', staff, { ky_luong: null }))[0]).toBeNull();
    expect((await values('=[cong]*PARAM("he_so")', staff, { he_so: '1.5' }))[0]).toBe('33');
    expect(compileError('=PARAM("khong_co")')).toMatchObject({
      key: 'formula.error.unknownParam',
      params: { param: 'khong_co' },
    });
    expect(compileError('=PARAM([luong])').key).toBe('formula.error.paramName');
    const plan = compile('=EDATE(PARAM("ky_luong"),1)');
    const sql = plan.sql('"hr$x"', '"hr$ord"', true);
    expect(plan.bindings).toEqual([
      { kind: 'param', key: 'ky_luong', type: 'month' },
      { kind: 'const', value: '1' },
    ]);
    expect(sql).not.toContain('2026');
    expect(sql).not.toContain('ky_luong');
  });

  it('a string constant with SQL in it is a bound value (AC-B4-14)', async () => {
    const evil = `'); DROP TABLE x; --`;
    const formula = `="${evil}"&[ma_nv]&"x""y"`;
    expect((await values(formula))[0]).toBe(`${evil}NV001x"y`);
    const sql = compile(formula).sql('"hr$x"', '"hr$ord"', true);
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('x"y');
    expect(sql).not.toMatch(/'[^']*NV/);
    // Only whitelisted identifiers reach the SQL: column keys are checked and quoted.
    expect(() =>
      compileFormula([{ key: 'r', formula: '=[a"b]' }], [{ key: 'a"b', type: 'string' }], {
        params: [],
      }),
    ).toThrow();
  });
});

describe('type inference (AC-B4-15, AC-B4-16)', () => {
  it('infers decimal/string; Admin can force integer; mixed branches → string + warning', async () => {
    expect(compile('=[luong]*2').columns[0]!.type).toBe('decimal');
    expect(compile('=LEN([ma_nv])').columns[0]!.type).toBe('decimal');
    expect(compile('=LEN([ma_nv])', { type: 'integer' }).columns[0]!.type).toBe('integer');
    const mixed = compile('=IF([luong]>0,"Có",0)').columns[0]!;
    expect(mixed.type).toBe('string');
    expect(mixed.mixedTypes).toBe(true);
    expect(() => compile('=LEN([ma_nv])', { type: 'date' })).toThrow();
    try {
      compile('=LEN([ma_nv])', { type: 'date' });
    } catch (e) {
      expect((e as { error: { messageKey: string } }).error.messageKey).toBe(
        'formula.error.typeMismatch',
      );
      expect((e as { field: string }).field).toBe('type');
    }
    const r = await run([{ key: 'r', formula: '=[cong]/4', type: 'integer' }]);
    expect(r.out.out!.columns.find((c) => c.key === 'r')!.type).toBe('integer');
    expect(rowsOf(r.out.out, ['r'])).toEqual([[null], [0], [0]]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({
      messageKey: 'formula.warning.rowErrors',
      params: { error: '#VALUE!', rows: '1' },
    });
  });

  it('design check: mixed-type warning on the field; schema matches the run; row order kept', async () => {
    const flow = {
      schemaVersion: 1,
      params: [],
      inputSlots: [
        {
          key: 'nv',
          label: 'Nhân viên',
          columns: [
            { key: 'ma_nv', label: 'Mã NV', aliases: ['Mã NV'], type: 'string', required: true },
            { key: 'luong', label: 'Lương', aliases: ['Lương'], type: 'decimal' },
          ],
        },
      ],
      nodes: [
        { id: 'in', type: 'input.excel', config: { slot: 'nv' } },
        {
          id: 'f',
          type: 'transform.formula',
          config: {
            columns: [
              { key: 'nhan', title: 'Nhãn', formula: '=IF([Lương]>0,"Có",0)' },
              { key: 'x', formula: '=XLOOKUP(1)' },
            ],
          },
        },
      ],
      edges: [{ from: 'in', to: 'f' }],
    };
    const res = await checkDesign(flow, { t, duck: nodeDuckDb });
    const err = res.issues.find((i) => i.nodeId === 'f' && i.severity === 'error')!;
    expect(err).toMatchObject({
      messageKey: 'formula.error.unknownFunction',
      path: 'columns.1.formula',
    });
    expect(err.text).toContain('Join');
    (flow.nodes[1]!.config as { columns: unknown[] }).columns.pop();
    const ok = await checkDesign(flow, { t, duck: nodeDuckDb });
    expect(ok.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(ok.issues.find((i) => i.messageKey === 'formula.warning.mixedTypes')).toMatchObject({
      nodeId: 'f',
      path: 'columns.0.formula',
    });
    expect(ok.nodes.f!.outputs!.out!.map((c) => [c.key, c.type])).toEqual(
      expect.arrayContaining([['nhan', 'string']]),
    );

    const r = await run([{ key: 'r', formula: '=[ma_nv]&"-"&[luong]' }]);
    expect(rowsOf(r.out.out, ['ma_nv', 'r'])).toEqual([
      ['NV001', 'NV001-1234567890123.25'],
      ['NV002', 'NV002-10000000'],
      ['NV003', 'NV003-'],
    ]);
  });
});

describe('runtime errors (AC-B4-20 … AC-B4-24)', () => {
  const rows: Value[][] = [];
  const zeros = [3, 50, 51, 400, 401, 700, 999];
  for (let i = 1; i <= 1000; i++)
    rows.push([new Big(1000 + i), new Big(zeros.includes(i) ? 0 : 20)]);
  const big = table(
    [
      ['luong', 'decimal'],
      ['cong', 'decimal'],
    ],
    rows,
  );
  big.columns[0]!.title = 'Lương';

  it('onError blank: cells left blank, one warning per error type, 5 first rows, no cell values (AC-B4-20)', async () => {
    const r = await run([{ key: 'don_gia', title: 'Đơn giá', formula: '=[luong]/[cong]' }], big);
    const out = r.out.out!;
    const blanks = out.rows.map((x, i) => (x.don_gia === null ? i + 1 : 0)).filter(Boolean);
    expect(blanks).toEqual(zeros);
    expect(r.warnings).toEqual([
      {
        nodeId: 'n',
        messageKey: 'formula.warning.rowErrors',
        params: { column: 'Đơn giá', error: '#DIV/0!', count: 7, rows: '3, 50, 51, 400, 401' },
      },
    ]);
    const text = t('formula.warning.rowErrors', { node: 'n', ...r.warnings[0]!.params });
    expect(text).toContain('#DIV/0!: 7 dòng');
    for (const v of ['1003', '1050', '20']) expect(JSON.stringify(r.warnings)).not.toContain(v);
  });

  it('onError fail: the run stops with node, column, error and first row (AC-B4-21)', async () => {
    await expect(
      run([{ key: 'don_gia', title: 'Đơn giá', formula: '=[luong]/[cong]', onError: 'fail' }], big),
    ).rejects.toMatchObject({
      messageKey: 'formula.error.rowError',
      nodeId: 'n',
      params: { column: 'Đơn giá', error: '#DIV/0!', row: 3 },
    });
  });

  it('IFERROR catches the error, no warning (AC-B4-22)', async () => {
    const r = await run([{ key: 'd', formula: '=IFERROR([luong]/[cong],0)' }], big);
    expect(r.warnings).toEqual([]);
    expect(r.out.out!.rows.filter((x) => plain(x.d) === '0')).toHaveLength(7);
  });

  it('a blanked error column reads as blank later; errors propagate inside a formula (AC-B4-23)', async () => {
    const r = await run(
      [
        { key: 'a_loi', formula: '=[luong]/[cong]' },
        { key: 'b', formula: '=[a_loi]+1' },
        { key: 'c', formula: '=ROUND([luong]/[cong],2)+1' },
      ],
      big,
    );
    expect(r.warnings.map((w) => w.params.column)).toEqual(['a_loi', 'c']);
    expect(plain(r.out.out!.rows[2]!.b)).toBe('1');
    expect(r.out.out!.rows[2]!.c).toBeNull();
  });

  it('overflow → #NUM!, never duckdb.error.decimalOverflow (AC-B4-24)', async () => {
    const r = await run([{ key: 'x', formula: '=10^30*10^30' }], big);
    expect(r.warnings[0]!.params).toMatchObject({ error: '#NUM!', count: 1000 });
    const r2 = await run([{ key: 'x', formula: '=[luong]*10000000000000000000000000' }], big);
    expect(r2.warnings[0]!.params).toMatchObject({ error: '#NUM!', count: 1000 });
  });
});

describe('golden fixture is in sync with its generator', () => {
  it('cases.json lists the formulas of golden.xlsx', () => {
    const cases = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../../../fixtures/formula-golden/cases.json'),
        'utf8',
      ),
    ) as { formula: string }[];
    expect(cases.length).toBeGreaterThan(150);
    for (const c of cases) expect(() => parseFormula(c.formula), c.formula).not.toThrow();
  });
});

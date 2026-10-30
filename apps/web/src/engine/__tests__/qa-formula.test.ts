/**
 * QA (verifier) — `transform.formula` (spec §12.2, §27.1–27.2), independent of the developer's
 * tests: injection fuzz, no DOUBLE in generated SQL, Excel rounding of negatives, runtime errors
 * never reaching DuckDB, `onError: 'fail'` producing no result. Fake data only.
 */
import { describe, expect, it } from 'vitest';
import { Big, isDecimal } from '../core/decimal';
import type { Value } from '../core/types';
import { compileFormula, displaySql, FormulaColumnError, runnableSql } from '../formula/compile';
import { FUNCTIONS } from '../formula/functions';
import { runNode, runWith, table } from './sql-helpers';

const tb = table(
  [
    ['ma_nv', 'string'],
    ['luong', 'decimal'],
    ['cong', 'decimal'],
    ['ngay', 'date'],
    ['so_nguyen', 'integer'],
  ],
  [
    ['NV001', new Big('15000000.5'), new Big('22'), '2024-02-29', 3],
    ['nv002', new Big('-2.5'), new Big('0'), null, null],
    [null, null, null, '2026-12-31', -7],
  ],
);
const INPUT = tb.columns.map((c) => ({ key: c.key, type: c.type, title: c.title! }));
const PARAMS = [{ key: 'he_so', type: 'number' as const }];

const plain = (v: Value | undefined) =>
  v === null || v === undefined ? null : isDecimal(v) ? v.toFixed() : v;

async function col(formula: string) {
  const r = await runNode(
    'transform.formula',
    { columns: [{ key: 'r', formula }] },
    { in: tb },
    { paramDefs: [{ key: 'he_so', label: 'Hệ số', type: 'number' }], params: { he_so: '1.5' } },
  );
  return { values: r.out.out!.rows.map((x) => plain(x.r)), warnings: r.warnings };
}

// ---------------------------------------------------------------------------------------------

describe('QA injection fuzz (AC-B4-13, AC-B4-14)', () => {
  const EVIL = [
    `'); DROP TABLE x; --`,
    `" OR 1=1 --`,
    `]]; SELECT 1; --`,
    `\\'; COPY x TO '/tmp/a'`,
    `/* */ read_csv('x')`,
    `\u0000?`,
    `$1`,
    `Ngày công'||'`,
    `"; ATTACH 'x'`,
  ];
  const ATOMS = ['[ma_nv]', '[luong]', '[cong]', '[ngay]', '[so_nguyen]', '1.5', 'TRUE', '""'];
  const FNS = ['IF', 'CONCAT', 'SUBSTITUTE', 'LEFT', 'SEARCH', 'FIND', 'TEXTJOIN', 'IFERROR'];

  // Seeded generator: formulas mixing hostile string literals with references and functions.
  let seed = 20261030;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const lit = (s: string) => `"${s.replaceAll('"', '""')}"`;
  function gen(depth: number): string {
    const k = rnd(depth > 3 ? 2 : 5);
    if (k === 0) return lit(EVIL[rnd(EVIL.length)]!);
    if (k === 1) return ATOMS[rnd(ATOMS.length)]!;
    if (k === 2) return `${gen(depth + 1)}&${gen(depth + 1)}`;
    if (k === 3) return `(${gen(depth + 1)})=${gen(depth + 1)}`;
    const fn = FNS[rnd(FNS.length)]!;
    const argc = fn === 'TEXTJOIN' ? 3 : fn === 'SUBSTITUTE' ? 3 : 2;
    const args = Array.from({ length: argc }, (_, i) =>
      fn === 'TEXTJOIN' && i === 1 ? 'TRUE' : gen(depth + 1),
    );
    return `${fn}(${args.join(',')})`;
  }

  it('hostile string constants never reach the SQL text and run as plain values', async () => {
    let ran = 0;
    for (let n = 0; n < 120; n++) {
      const formula = `=${gen(0)}`;
      let plan;
      try {
        plan = compileFormula([{ key: 'r', formula }], INPUT, { params: PARAMS });
      } catch (err) {
        expect(err).toBeInstanceOf(FormulaColumnError);
        continue;
      }
      const sql = runnableSql(plan.sql('"hr$x"', '"hr$ord"', true));
      for (const piece of [
        'DROP',
        'COPY',
        'ATTACH',
        'read_csv',
        '/tmp/a',
        '1=1',
        '--',
        '/*',
        ';',
      ]) {
        expect(sql, formula).not.toContain(piece);
      }
      // Only quoted identifiers of the input / hidden columns appear in double quotes.
      for (const m of sql.matchAll(/"([^"]*)"/g)) {
        expect(m[1], formula).toMatch(/^(hr\$[a-z0-9_]+|ma_nv|luong|cong|ngay|so_nguyen|r)$/);
      }
      // No string literal in the SQL other than the error codes the transpiler writes itself.
      for (const m of sql.matchAll(/'([^']*)'/g)) {
        expect(m[1], formula).toMatch(/^(#DIV\/0!|#VALUE!|#NUM!|#N\/A|TRUE|FALSE|| {2,}|g| |)$/);
      }
      const r = await col(formula);
      expect(r.values).toHaveLength(3);
      ran++;
    }
    expect(ran).toBeGreaterThan(60);
  }, 120_000);

  it('a constant equal to a column name stays a value; PARAM value is bound and not displayed', async () => {
    expect((await col('="[luong]"&"luong"')).values[0]).toBe('[luong]luong');
    const plan = compileFormula([{ key: 'r', formula: '=[cong]*PARAM("he_so")' }], INPUT, {
      params: PARAMS,
    });
    const shown = displaySql(plan.sql('"hr$x"', '"hr$ord"', false));
    expect(shown).not.toContain('1.5');
    expect(shown).not.toContain('he_so');
    expect(shown).toMatch(/\$1/);
    expect((await col('=[cong]*PARAM("he_so")')).values).toEqual(['33', '0', '0']);
  });

  it('formula text limits: > 2,000 characters and nesting > 64 are design errors', () => {
    const err = (formula: string) => {
      try {
        compileFormula([{ key: 'r', formula }], INPUT, { params: PARAMS });
      } catch (e) {
        return (e as FormulaColumnError).error.messageKey;
      }
      return null;
    };
    expect(err(`="${'a'.repeat(2000)}"`)).toBe('formula.error.tooLong');
    expect(err(`=${'ABS('.repeat(65)}1${')'.repeat(65)}`)).toBe('formula.error.tooDeep');
    expect(err(`=${'ABS('.repeat(64)}1${')'.repeat(64)}`)).toBeNull();
    expect(err('=1;2')).toBe('formula.error.syntax');
    expect(err('=SUM(1;2)')).toBe('formula.error.syntax');
    expect(err('=1 -- comment')).toBe('formula.error.syntax');
  });
});

// ---------------------------------------------------------------------------------------------

describe('QA decimals (AC-B4-08, AC-B4-09)', () => {
  /** One call per function with representative arguments. */
  const SAMPLES: Record<string, string> = {
    IF: 'IF([luong]>0,[luong]/3,[cong])',
    IFS: 'IFS([luong]>1,[luong]*1.1,TRUE,0)',
    AND: 'AND([luong]>0,[cong]>0)',
    OR: 'OR([luong]>0,[cong]>0)',
    NOT: 'NOT([luong]>0)',
    SWITCH: 'SWITCH([cong],22,1.5,0)',
    IFERROR: 'IFERROR([luong]/[cong],0)',
    ISBLANK: 'ISBLANK([luong])',
    ISNUMBER: 'ISNUMBER([luong])',
    ROUND: 'ROUND([luong]/7,2)',
    ROUNDUP: 'ROUNDUP([luong]/7,2)',
    ROUNDDOWN: 'ROUNDDOWN([luong]/7,2)',
    INT: 'INT([luong]/7)',
    ABS: 'ABS([luong])',
    MIN: 'MIN([luong],[cong])',
    MAX: 'MAX([luong],[cong])',
    MOD: 'MOD([luong],7)',
    SUM: 'SUM([luong],[cong],[so_nguyen])',
    LEFT: 'LEFT([ma_nv],2)',
    RIGHT: 'RIGHT([ma_nv],2)',
    MID: 'MID([ma_nv],2,2)',
    LEN: 'LEN([ma_nv])',
    TRIM: 'TRIM([ma_nv])',
    UPPER: 'UPPER([ma_nv])',
    LOWER: 'LOWER([ma_nv])',
    PROPER: 'PROPER([ma_nv])',
    CONCAT: 'CONCAT([ma_nv],[luong])',
    TEXTJOIN: 'TEXTJOIN("-",TRUE,[ma_nv],[luong])',
    SUBSTITUTE: 'SUBSTITUTE([ma_nv],"N","M",1)',
    FIND: 'FIND("V",[ma_nv])',
    SEARCH: 'SEARCH("v",[ma_nv])',
    VALUE: 'VALUE("1.25")*[luong]',
    DATE: 'DATE(2026,2,29)',
    YEAR: 'YEAR([ngay])',
    MONTH: 'MONTH([ngay])',
    DAY: 'DAY([ngay])',
    EDATE: 'EDATE([ngay],1)',
    EOMONTH: 'EOMONTH([ngay],0)',
    DATEDIF: 'DATEDIF([ngay],DATE(2027,1,1),"M")',
    WEEKDAY: 'WEEKDAY([ngay],2)',
    PARAM: '[luong]*PARAM("he_so")',
  };

  it('every function (41) compiles to SQL with no DOUBLE/FLOAT, integer powers included', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(FUNCTIONS.map((f) => f.name).sort());
    for (const [name, f] of Object.entries(SAMPLES)) {
      for (const formula of [`=${f}`, `=(${f})^2`, `=(${f})^-2`, `=(${f})%`]) {
        let sql: string;
        try {
          sql = compileFormula([{ key: 'r', formula }], INPUT, { params: PARAMS }).sql(
            '"hr$x"',
            '"hr$ord"',
            true,
          );
        } catch (err) {
          // ^/% on a date or text result can be a type error: only the structure is checked.
          expect(err, `${name}: ${formula}`).toBeInstanceOf(FormulaColumnError);
          continue;
        }
        expect(sql, `${name}: ${formula}`).not.toMatch(/DOUBLE|FLOAT|REAL|printf/i);
      }
    }
  });

  it('ROUND family on negatives and halves: half away from zero, like Excel', async () => {
    const cases: [string, string][] = [
      ['=ROUND(-0.5,0)', '-1'],
      ['=ROUND(-1.5,0)', '-2'],
      ['=ROUND(-2.675,2)', '-2.68'],
      ['=ROUND(-1.005,2)', '-1.01'],
      ['=ROUND(-1250,-2)', '-1300'],
      ['=ROUND(-0.0000000005,9)', '-0.000000001'],
      ['=ROUNDUP(-0.0000000001,0)', '-1'],
      ['=ROUNDUP(-1.21,1)', '-1.3'],
      ['=ROUNDDOWN(-1.29,1)', '-1.2'],
      ['=ROUND(-[luong]/3,0)', '-5000000'],
      ['=ROUND(2.5,0)', '3'],
      ['=ROUND(1/3,2.9)', '0.33'],
      ['=INT(-0.0000000001)', '-1'],
      ['=MOD(-7,-3)', '-1'],
      ['=MOD(7,-3)', '-2'],
    ];
    for (const [f, want] of cases) expect((await col(f)).values[0], f).toBe(want);
  });

  it('exact sums and products of money (no binary floating point)', async () => {
    expect((await col('=0.1*3-0.3')).values[0]).toBe('0');
    expect((await col('=[luong]*0.1+[luong]*0.2')).values[0]).toBe('4500000.15');
    expect((await col('=1234567890123456.78*100')).values[0]).toBe('123456789012345678');
    expect((await col('=[so_nguyen]/2')).values).toEqual(['1.5', '0', '-3.5']);
  });
});

// ---------------------------------------------------------------------------------------------

describe('QA blanks, overwrite, references (AC-B4-04 … AC-B4-07)', () => {
  it('blank cells: 0 in arithmetic, "" in text, =[A] stays blank, integer blank too', async () => {
    expect((await col('=[luong]+[so_nguyen]')).values).toEqual(['15000003.5', '-2.5', '-7']);
    expect((await col('=[ma_nv]&"-"')).values).toEqual(['NV001-', 'nv002-', '-']);
    expect((await col('=[so_nguyen]')).values).toEqual(['3', null, '-7']);
    expect((await col('=[ngay]')).values).toEqual(['2024-02-29', null, '2026-12-31']);
    expect((await col('=ISBLANK([ma_nv])')).values).toEqual([false, false, true]);
    expect((await col('=[ngay]=""')).values).toEqual([false, true, false]);
  });

  it('overwriting a column: same formula reads the old value, the next column the new one', async () => {
    const r = await runNode(
      'transform.formula',
      {
        columns: [
          { key: 'luong', formula: '=[luong]*2' },
          { key: 'x', formula: '=[luong]+1' },
        ],
      },
      { in: tb },
    );
    const out = r.out.out!;
    expect(out.columns.map((c) => c.key)).toEqual([
      'ma_nv',
      'luong',
      'cong',
      'ngay',
      'so_nguyen',
      'x',
    ]);
    expect(out.rows.map((x) => [plain(x.luong), plain(x.x)])).toEqual([
      ['30000001', '30000002'],
      ['-5', '-4'],
      ['0', '1'], // blank × 2 = 0 (only a bare reference stays blank)
    ]);
  });

  it('forward reference, ambiguous title, unknown column → design errors on the right column', async () => {
    const t2 = table(
      [
        ['a', 'decimal'],
        ['b', 'decimal'],
      ],
      [[new Big(1), new Big(2)]],
    );
    t2.columns[0]!.title = 'Số';
    t2.columns[1]!.title = 'số ';
    const fail = (columns: { key: string; formula: string; title?: string }[]) =>
      runNode('transform.formula', { columns }, { in: t2 });
    await expect(
      fail([
        { key: 'x', formula: '=[y]+1' },
        { key: 'y', formula: '=1' },
      ]),
    ).rejects.toMatchObject({
      messageKey: 'formula.error.forwardReference',
      params: { path: 'columns.0.formula' },
    });
    await expect(fail([{ key: 'x', formula: '=[Số]+1' }])).rejects.toMatchObject({
      messageKey: 'formula.error.ambiguousTitle',
    });
    await expect(
      fail([
        { key: 'ok', formula: '=1' },
        { key: 'x', formula: '=[khong_co]' },
      ]),
    ).rejects.toMatchObject({
      messageKey: 'formula.error.unknownColumn',
      params: { path: 'columns.1.formula' },
    });
    // The key always works, and a new column's title resolves for later columns.
    const ok = await runNode(
      'transform.formula',
      {
        columns: [
          { key: 'x', formula: '=[a]+[b]', title: 'Tổng' },
          { key: 'y', formula: '=[tổng]*2' },
        ],
      },
      { in: t2 },
    );
    expect(plain(ok.out.out!.rows[0]!.y)).toBe('6');
  });
});

// ---------------------------------------------------------------------------------------------

describe('QA runtime errors (AC-B4-20, AC-B4-21, AC-B4-24)', () => {
  it('onError fail stops the run: no node after the formula produces a result', async () => {
    const r = runWith(
      { src: tb },
      [
        {
          id: 'f',
          type: 'transform.formula',
          config: { columns: [{ key: 'd', formula: '=[luong]/[cong]', onError: 'fail' }] },
        },
        { id: 'p', type: 'output.preview', config: { title: 'Xem' } },
      ],
      [
        { from: 'src', to: 'f' },
        { from: 'f', to: 'p' },
      ],
    );
    await expect(r).rejects.toMatchObject({
      messageKey: 'formula.error.rowError',
      nodeId: 'f',
      params: { error: '#DIV/0!', row: 2, count: 2 },
    });
    // Neither the error nor its params carry a cell value.
    const err = await r.catch((e: unknown) => e);
    const text = JSON.stringify(err);
    for (const v of ['15000000', 'NV001', 'nv002', '2024-02-29']) expect(text).not.toContain(v);
  });

  it('warnings carry error type, counts and input row numbers only', async () => {
    const r = await col('=VALUE([ma_nv])');
    expect(r.values).toEqual([null, null, '0']);
    expect(r.warnings).toEqual([
      expect.objectContaining({
        messageKey: 'formula.warning.rowErrors',
        params: { column: 'r', error: '#VALUE!', count: 2, rows: '1, 2' },
      }),
    ]);
    expect(JSON.stringify(r.warnings)).not.toMatch(/NV00|nv00/);
  });

  it('out-of-range numbers in date/number functions become Excel errors, not DuckDB errors', async () => {
    for (const f of [
      '=DATE(99999,1,1)',
      '=DATE(2026,1,10^15)',
      '=EDATE([ngay],10^20)',
      '=EOMONTH([ngay],-[luong]*10^10)',
      '=WEEKDAY([ngay],10^20)',
      '=[ngay]+10^20',
      '=ROUND(1,-10^20)',
      '=[luong]*10^27',
      '=10^28/0.1',
      '=FIND("a","a",10^20)',
      '=SUBSTITUTE("a","a","b",10^20)',
      '=SEARCH(REPT_IS_NOT_A_FUNCTION,"a")'.replace('REPT_IS_NOT_A_FUNCTION', '"?"&[ma_nv]'),
    ]) {
      await expect(col(f), f).resolves.toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('text length argument above 2^32 (fixed in R1-fix)', () => {
  // toInt clamps to ±10^15, but DuckDB's left()/substring() refuse a length > 4,294,967,295
  // ("Out of Range Error: Substring length outside of supported range"). One row with a large
  // count stops the whole run with the misleading `duckdb.error.decimalOverflow` (AC-B4-24:
  // errors are per row; macros never raise). RIGHT is not affected.
  it('LEFT("abc",10^10) → "abc" like Excel (count larger than the text)', async () => {
    expect((await col('=LEFT("abc",10^10)')).values[0]).toBe('abc');
  });
  it('MID([ma_nv],1,[luong]*1000) → whole text', async () => {
    expect((await col('=MID([ma_nv],1,[luong]*1000)')).values[0]).toBe('NV001');
  });
});

describe('KNOWN BUG — R1-fix: tooComplex counts projection levels of the whole node', () => {
  // MAX_STAGES = 150 applies to the node, not to one column: a realistic payroll chain where
  // each column rounds the previous one (`=ROUND([prev]*1.1/[cong],2)`) is refused at the 17th
  // column (c16), and the message advises splitting into more formula *columns*, which does not
  // help (only splitting into several nodes does). `=IFERROR([prev]/[b],0)+[a]` stops at c25.
  it.fails('20 chained ROUND columns compile and run', async () => {
    const columns = Array.from({ length: 20 }, (_, i) => ({
      key: `c${i}`,
      formula: `=ROUND([${i === 0 ? 'luong' : `c${i - 1}`}]*1.1/[cong],2)`,
    }));
    const r = await runNode('transform.formula', { columns }, { in: tb });
    expect(r.out.out!.rows).toHaveLength(3);
  });
});

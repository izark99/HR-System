import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { Big, decimalFromNumber } from '../core/decimal';
import { GOLDEN_DIR, loadCases, norm, runCase, type Expect } from './formula-cases';

/**
 * AC-B4-01 / AC-B4-30: every case of fixtures/formula-golden/cases.json (≥ 3 per function, with
 * blank cells, negative numbers, Vietnamese text, month ends, leap years, errors) through the
 * engine on DuckDB, against
 *  1. the expected result written in cases.json (always), and
 *  2. the value Excel saved in golden-excel.xlsx (Harold's recalculated copy), when present:
 *     exact match, numbers compared after rounding to 15 significant digits like Excel shows.
 *     Intended differences are listed per case in cases.json (`excel` + `note`), e.g. decimals
 *     more exact than Excel, a bare blank reference staying blank.
 */

const cases = loadCases();
const GOLDEN = resolve(GOLDEN_DIR, 'golden-excel.xlsx');

describe('formula cases (cases.json)', () => {
  it('covers every function of spec §9.1 except PARAM with ≥ 3 cases', () => {
    const counts = new Map<string, number>();
    for (const c of cases) counts.set(c.fn, (counts.get(c.fn) ?? 0) + 1);
    const fns = [...counts.keys()].filter((k) => k !== 'OP');
    expect(fns).toHaveLength(40);
    for (const fn of fns) expect(counts.get(fn), fn).toBeGreaterThanOrEqual(3);
  });

  it.each(cases.map((c) => [c.id, c.formula, c] as const))('%s %s', async (_id, _f, c) => {
    expect(norm(await runCase(c))).toEqual(norm(c.expect));
  });
});

/** Excel cell (cached value) → comparable expectation. */
function excelValue(cell: XLSX.CellObject | undefined): Expect {
  if (!cell || cell.t === 'z') return { type: 'blank', value: null };
  if (cell.t === 'e') return { type: 'error', value: String(cell.w ?? '') };
  if (cell.t === 'b') return { type: 'boolean', value: Boolean(cell.v) };
  if (cell.t === 'n')
    return { type: 'number', value: decimalFromNumber(Number(cell.v)).toString() };
  return { type: 'string', value: String(cell.v ?? '') };
}

/** Engine result as Excel would store it: 15 significant digits, dates as serial numbers. */
function asExcel(e: Expect): Expect {
  if (e.type === 'number') {
    return {
      type: 'number',
      value: new Big(Number(new Big(String(e.value)).toPrecision(15))).toString(),
    };
  }
  if (e.type === 'date') {
    const days = (Date.parse(`${String(e.value)}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
    return { type: 'number', value: String(days) };
  }
  return e;
}

describe('golden: Excel cached values (golden-excel.xlsx)', () => {
  const present = existsSync(GOLDEN);
  // The file comes from Harold (Excel desktop, recalculated, see fixtures/formula-golden/README.md).
  const run = present ? it : it.skip;
  run(
    present
      ? 'engine matches Excel on every case'
      : 'SKIPPED: fixtures/formula-golden/golden-excel.xlsx not provided yet (Harold recalculates golden.xlsx in Excel)',
    async () => {
      const wb = XLSX.read(readFileSync(GOLDEN), { cellFormula: false, cellNF: false });
      const ws = wb.Sheets.cases!;
      const byId = new Map<string, number>();
      const range = XLSX.utils.decode_range(ws['!ref']!);
      for (let r = 1; r <= range.e.r; r++) {
        const id = (ws[XLSX.utils.encode_cell({ r, c: 0 })] as XLSX.CellObject | undefined)?.v;
        if (typeof id === 'string') byId.set(id, r);
      }
      const mismatches: string[] = [];
      for (const c of cases) {
        const r = byId.get(c.id);
        if (r === undefined) {
          mismatches.push(`${c.id}: missing in golden file`);
          continue;
        }
        const excel = excelValue(
          ws[XLSX.utils.encode_cell({ r, c: 6 })] as XLSX.CellObject | undefined,
        );
        const want = c.excel ? asExcel(norm(c.excel)) : asExcel(norm(await runCase(c)));
        if (JSON.stringify(asExcel(excel)) !== JSON.stringify(want)) {
          mismatches.push(
            `${c.id} ${c.formula}: Excel ${JSON.stringify(excel)} vs ${JSON.stringify(want)}`,
          );
        }
      }
      expect(mismatches).toEqual([]);
    },
  );
});

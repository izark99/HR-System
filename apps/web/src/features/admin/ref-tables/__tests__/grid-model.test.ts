import { describe, expect, it } from 'vitest';
import {
  addRows,
  editCells,
  gridProblems,
  gridRows,
  gridSummary,
  initGrid,
  isMultiCell,
  parseClipboard,
  paste,
  redo,
  toggleRemoved,
  undo,
  type GridState,
} from '../grid-model';
import type { RefColumn } from '../model';

const COLS: RefColumn[] = [
  { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string', aliases: [], isKey: true },
  { key: 'ten_cn', title: 'Tên chi nhánh', type: 'string', aliases: [], isKey: false },
  { key: 'vung', title: 'Vùng', type: 'integer', aliases: [], isKey: false },
];
const W = COLS.length;

function start(): GridState {
  return initGrid(COLS, [
    { ma_cn: 'CN01', ten_cn: 'Hồ Chí Minh', vung: 1 },
    { ma_cn: 'CN02', ten_cn: 'Hà Nội', vung: 1 },
    { ma_cn: 'CN03', ten_cn: 'Cần Thơ', vung: 2 },
  ]);
}

const texts = (s: GridState) => s.rows.map((r) => r.cells.join('|'));

describe('grid editing (AC-RT-04)', () => {
  it('loads stored values as text', () => {
    expect(texts(start())).toEqual(['CN01|Hồ Chí Minh|1', 'CN02|Hà Nội|1', 'CN03|Cần Thơ|2']);
    expect(gridSummary(start()).dirty).toBe(false);
  });

  it('edits, undoes and redoes one cell', () => {
    let s = editCells(start(), [{ row: 1, col: 2, value: '3' }], W);
    expect(s.rows[1]!.cells[2]).toBe('3');
    expect(gridSummary(s)).toEqual({ edited: 1, added: 0, removed: 0, dirty: true });
    s = undo(s, W);
    expect(s.rows[1]!.cells[2]).toBe('1');
    expect(gridSummary(s).dirty).toBe(false);
    s = redo(s, W);
    expect(s.rows[1]!.cells[2]).toBe('3');
    // A new change clears the redo stack.
    s = undo(s, W);
    s = editCells(s, [{ row: 0, col: 1, value: 'TP HCM' }], W);
    expect(redo(s, W)).toBe(s);
  });

  it('skips a change that keeps the same text (no undo step)', () => {
    const s0 = start();
    expect(editCells(s0, [{ row: 0, col: 0, value: 'CN01' }], W)).toBe(s0);
  });

  it('adds rows and marks rows removed, both undoable', () => {
    let s = addRows(start(), 1, W);
    expect(s.rows).toHaveLength(4);
    expect(gridSummary(s).added).toBe(0); // blank new row: nothing to save yet
    s = editCells(s, [{ row: 3, col: 0, value: 'CN04' }], W);
    s = toggleRemoved(s, 0, W);
    expect(gridSummary(s)).toEqual({ edited: 0, added: 1, removed: 1, dirty: true });
    s = undo(s, W); // removal
    s = undo(s, W); // cell
    s = undo(s, W); // row
    expect(texts(s)).toEqual(texts(start()));
    s = redo(s, W);
    expect(s.rows).toHaveLength(4);
    expect(new Set(s.rows.map((r) => r.id)).size).toBe(4);
  });

  it('pastes a block from the selected cell, adding rows past the end (one undo step)', () => {
    const r = paste(start(), [1, 2], 1, 'Hà Nội 2\t5\nCần Thơ 2\t6\nLong An\t7\n', W);
    expect(r).toMatchObject({ rows: 3, added: 1 });
    expect(texts(r.state)).toEqual([
      'CN01|Hồ Chí Minh|1',
      'CN02|Hà Nội 2|5',
      'CN03|Cần Thơ 2|6',
      '|Long An|7',
    ]);
    expect(texts(undo(r.state, W))).toEqual(texts(start()));
  });

  it('pastes into the rows shown (search) and drops cells past the last column', () => {
    const r = paste(start(), [0, 2], 2, '9\textra\n8', W);
    expect(texts(r.state)).toEqual(['CN01|Hồ Chí Minh|9', 'CN02|Hà Nội|1', 'CN03|Cần Thơ|8']);
  });

  it('skips rows marked for removal when pasting (they are not saved)', () => {
    let s = toggleRemoved(start(), 1, W);
    const r = paste(s, [0, 1, 2], 1, 'A\nB\nC', W);
    s = r.state;
    expect(texts(s)).toEqual(['CN01|A|1', 'CN02|Hà Nội|1', 'CN03|B|2', '|C|']);
    expect(r.added).toBe(1);
  });

  it('parses Excel clipboard text (CRLF, quoted cells, trailing line break)', () => {
    expect(parseClipboard('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseClipboard('"x\ty"\t"say ""hi"""\n"two\nlines"\tz')).toEqual([
      ['x\ty', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
    expect(parseClipboard('a\t\tc')).toEqual([['a', '', 'c']]);
    expect(isMultiCell('CN01')).toBe(false);
    expect(isMultiCell('CN01\n')).toBe(false);
    expect(isMultiCell('CN01\tA')).toBe(true);
    expect(isMultiCell('CN01\nCN02')).toBe(true);
  });

  it('flags type errors, blank and repeated keys on the rows kept', () => {
    let s = editCells(
      start(),
      [
        { row: 0, col: 2, value: 'một' },
        { row: 2, col: 0, value: ' cn02 ' },
      ],
      W,
    );
    s = addRows(s, 2, W);
    s = editCells(s, [{ row: 3, col: 1, value: 'Không mã' }], W);
    const p = gridProblems(s, COLS);
    expect(Object.fromEntries(p)).toEqual({
      '0:2': 'type',
      '2:0': 'keyDuplicate',
      '3:0': 'keyBlank',
    });
    expect(gridRows(s, COLS)).toBeNull();
    // Removing the duplicate row and fixing the rest clears every problem.
    s = toggleRemoved(s, 2, W);
    s = editCells(
      s,
      [
        { row: 0, col: 2, value: '1' },
        { row: 3, col: 0, value: 'CN04' },
      ],
      W,
    );
    expect(gridProblems(s, COLS).size).toBe(0);
    expect(gridRows(s, COLS)).toEqual([
      { ma_cn: 'CN01', ten_cn: 'Hồ Chí Minh', vung: 1 },
      { ma_cn: 'CN02', ten_cn: 'Hà Nội', vung: 1 },
      { ma_cn: 'CN04', ten_cn: 'Không mã' },
    ]);
  });

  it('keeps at most 200 undo steps', () => {
    let s = start();
    for (let i = 0; i < 250; i++) s = editCells(s, [{ row: 0, col: 1, value: `v${i}` }], W);
    expect(s.past).toHaveLength(200);
    for (let i = 0; i < 300; i++) s = undo(s, W);
    expect(s.rows[0]!.cells[1]).toBe('v49');
  });
});

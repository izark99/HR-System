/**
 * Editing state of the data grid of a draft (spec §34 AC-RT-04): cells as typed text, rows added
 * and rows marked for removal (until saved), undo / redo of every committed change, multi-cell
 * paste from Excel. Pure and immutable (React state); rows only ever grow at the end, so a row is
 * addressed by its index.
 */
import {
  formatCell,
  parseCell,
  rowKey,
  type CellProblem,
  type RefColumn,
  type RefRow,
  type RefValue,
} from './model';

export interface GridRow {
  /** Stable React key. */
  id: number;
  cells: string[];
  /** Texts as loaded (null: a row added in this session). */
  original: string[] | null;
  /** Marked for removal (struck through until saved, "Bỏ xóa" undoes it). */
  removed: boolean;
}

interface CellChange {
  row: number;
  col: number;
  before: string;
  after: string;
}

/** One undo step. Redo: add rows, set cells, toggle; undo: the reverse. */
interface Step {
  cells: CellChange[];
  /** Rows appended at the end by this step. */
  added: number;
  /** Rows whose removal mark was toggled. */
  toggled: number[];
}

export interface GridState {
  rows: GridRow[];
  past: Step[];
  future: Step[];
  nextId: number;
}

/** Undo history kept (older steps are forgotten). */
const HISTORY = 200;

export function initGrid(columns: readonly RefColumn[], rows: readonly RefRow[]): GridState {
  const list: GridRow[] = rows.map((r, i) => {
    const cells = columns.map((c) => formatCell(r[c.key], c.type));
    return { id: i, cells, original: cells, removed: false };
  });
  return { rows: list, past: [], future: [], nextId: list.length };
}

function emptyRow(id: number, width: number): GridRow {
  return { id, cells: Array.from({ length: width }, () => ''), original: null, removed: false };
}

function apply(state: GridState, step: Step, dir: 'redo' | 'undo', width: number): GridRow[] {
  let rows = state.rows;
  let nextId = state.nextId;
  if (dir === 'redo' && step.added > 0) {
    rows = rows.concat(Array.from({ length: step.added }, () => emptyRow(nextId++, width)));
  } else {
    rows = rows.slice();
  }
  const touched = new Map<number, string[]>();
  const cellsOf = (i: number) => {
    let c = touched.get(i);
    if (!c) {
      c = rows[i]!.cells.slice();
      touched.set(i, c);
    }
    return c;
  };
  for (const ch of step.cells) {
    if (ch.row < rows.length) cellsOf(ch.row)[ch.col] = dir === 'redo' ? ch.after : ch.before;
  }
  for (const [i, cells] of touched) rows[i] = { ...rows[i]!, cells };
  for (const i of step.toggled) if (rows[i]) rows[i] = { ...rows[i], removed: !rows[i].removed };
  if (dir === 'undo' && step.added > 0) rows = rows.slice(0, rows.length - step.added);
  return rows;
}

function push(state: GridState, step: Step, width: number): GridState {
  if (step.cells.length === 0 && step.added === 0 && step.toggled.length === 0) return state;
  const rows = apply(state, step, 'redo', width);
  return {
    rows,
    past: [...state.past.slice(-(HISTORY - 1)), step],
    future: [],
    nextId: state.nextId + step.added,
  };
}

/** Set cell texts (one undo step); unchanged cells are skipped. */
export function editCells(
  state: GridState,
  changes: readonly { row: number; col: number; value: string }[],
  width: number,
): GridState {
  const cells: CellChange[] = [];
  for (const c of changes) {
    const before = state.rows[c.row]?.cells[c.col];
    if (before === undefined || before === c.value) continue;
    cells.push({ row: c.row, col: c.col, before, after: c.value });
  }
  return push(state, { cells, added: 0, toggled: [] }, width);
}

export function addRows(state: GridState, count: number, width: number): GridState {
  return push(state, { cells: [], added: count, toggled: [] }, width);
}

export function toggleRemoved(state: GridState, row: number, width: number): GridState {
  if (!state.rows[row]) return state;
  return push(state, { cells: [], added: 0, toggled: [row] }, width);
}

export function undo(state: GridState, width: number): GridState {
  const step = state.past.at(-1);
  if (!step) return state;
  return {
    rows: apply(state, step, 'undo', width),
    past: state.past.slice(0, -1),
    future: [...state.future, step],
    nextId: state.nextId,
  };
}

export function redo(state: GridState, width: number): GridState {
  const step = state.future.at(-1);
  if (!step) return state;
  return {
    rows: apply(state, step, 'redo', width),
    past: [...state.past, step],
    future: state.future.slice(0, -1),
    nextId: state.nextId + step.added,
  };
}

/**
 * Clipboard text of Excel / Google Sheets → cells: rows split by line breaks, cells by tabs; a
 * cell in double quotes may hold tabs, line breaks and doubled quotes. The final line break of a
 * copied range is not a row.
 */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  let atCellStart = true;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
      i++;
      continue;
    }
    if (ch === '\t') {
      row.push(cell);
      cell = '';
      atCellStart = true;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    atCellStart = false;
    i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** True when pasted text spans more than one cell (else the input handles it natively). */
export function isMultiCell(text: string): boolean {
  const parsed = parseClipboard(text);
  return parsed.length > 1 || (parsed[0]?.length ?? 0) > 1;
}

/**
 * Paste a block at (`targets[0]`, `col`): the block's rows go to `targets` in order (the rows on
 * screen, which may be filtered by the search) skipping rows marked for removal, then to new rows
 * at the end; cells past the last column are left out. One undo step.
 */
export function paste(
  state: GridState,
  targets: readonly number[],
  col: number,
  text: string,
  width: number,
): { state: GridState; rows: number; added: number } {
  const block = parseClipboard(text);
  // Rows marked for removal are stepped over: a pasted line never lands in a row that will not
  // be saved (verifier 2026-11-09).
  const open = targets.filter((i) => !state.rows[i]?.removed);
  const cells: CellChange[] = [];
  let added = 0;
  block.forEach((values, r) => {
    let row = open[r];
    if (row === undefined) row = state.rows.length + added++;
    values.forEach((value, k) => {
      const c = col + k;
      if (c >= width) return;
      const before = state.rows[row]?.cells[c] ?? '';
      if (before !== value) cells.push({ row, col: c, before, after: value });
    });
  });
  return {
    state: push(state, { cells, added, toggled: [] }, width),
    rows: block.length,
    added,
  };
}

// ---- checks and summary ------------------------------------------------------------------------

/** Problem of every cell (by `row:col`) of the rows kept, duplicates of the key included. */
export function gridProblems(
  state: GridState,
  columns: readonly RefColumn[],
): Map<string, CellProblem> {
  const out = new Map<string, CellProblem>();
  const keyCols = columns.filter((c) => c.isKey);
  const keyIdx = keyCols.map((c) => columns.indexOf(c));
  const firstByKey = new Map<string, number>();
  state.rows.forEach((r, i) => {
    // Removed rows and new rows left blank are not saved: nothing to check.
    if (r.removed || (r.original === null && r.cells.every((c) => c.trim() === ''))) return;
    const values: RefRow = {};
    columns.forEach((c, j) => {
      const p = parseCell(r.cells[j] ?? '', c.type);
      if (!p.ok) out.set(`${i}:${j}`, p.problem);
      else values[c.key] = p.value;
    });
    if (keyIdx.some((j) => out.has(`${i}:${j}`))) return;
    const k = rowKey(values, keyCols);
    if (k === null) {
      keyIdx.forEach((j) => {
        if ((r.cells[j] ?? '').trim() === '') out.set(`${i}:${j}`, 'keyBlank');
      });
      return;
    }
    const first = firstByKey.get(k);
    if (first === undefined) firstByKey.set(k, i);
    else keyIdx.forEach((j) => out.set(`${i}:${j}`, 'keyDuplicate'));
  });
  return out;
}

/** Unsaved changes as counted on the toolbar ("3 ô sửa · 1 dòng mới · 2 dòng xóa"). */
export function gridSummary(state: GridState) {
  let edited = 0;
  let added = 0;
  let removed = 0;
  for (const r of state.rows) {
    if (r.original === null) {
      if (!r.removed && r.cells.some((c) => c.trim() !== '')) added++;
      continue;
    }
    if (r.removed) {
      removed++;
      continue;
    }
    r.cells.forEach((c, j) => {
      if (c !== r.original![j]) edited++;
    });
  }
  return { edited, added, removed, dirty: edited + added + removed > 0 };
}

/**
 * Rows to save: removed rows and new rows left blank are skipped; null when a cell does not
 * parse (the grid shows it).
 */
export function gridRows(state: GridState, columns: readonly RefColumn[]): RefRow[] | null {
  const out: RefRow[] = [];
  for (const r of state.rows) {
    if (r.removed) continue;
    if (r.original === null && r.cells.every((c) => c.trim() === '')) continue;
    const row: Record<string, RefValue> = {};
    for (let j = 0; j < columns.length; j++) {
      const c = columns[j]!;
      const p = parseCell(r.cells[j] ?? '', c.type);
      if (!p.ok) return null;
      if (p.value !== null) row[c.key] = p.value;
    }
    out.push(row);
  }
  return out;
}

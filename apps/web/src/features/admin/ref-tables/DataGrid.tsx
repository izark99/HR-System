import { memo, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { denseTdClass, denseThClass } from '../../../components/DataTable';
import { TrashIcon, UndoIcon } from '../../../components/icons';
import { RowIcon, rowIconClass } from '../../../components/RowActions';
import { Chip, cx } from '../../../components/ui';
import { isMultiCell, type GridRow } from './grid-model';
import { parseCell, type CellProblem, type RefColumn } from './model';
import { useTypeLabel } from './shared';

export interface GridHandlers {
  /** Commit a cell's text (one undo step when it changed). */
  commit: (row: number, col: number, value: string) => void;
  /** Multi-cell paste at the visible position `pos`. */
  paste: (pos: number, col: number, text: string) => void;
  toggle: (row: number) => void;
  undo: () => void;
  redo: () => void;
}

/** Focus the cell input at visible position `pos`, column `col` (if it exists). */
function focusCell(grid: HTMLElement | null, pos: number, col: number): boolean {
  const el = grid?.querySelector<HTMLInputElement>(`[data-pos="${pos}"][data-col="${col}"]`);
  if (!el) return false;
  el.focus();
  el.select();
  return true;
}

const cellInputClass =
  'h-control-sm w-full min-w-40 rounded-input border bg-transparent px-2 text-dense text-ink ' +
  'focus:border-teal-strong focus:bg-card focus:outline-none disabled:cursor-not-allowed';

/**
 * One editable cell. The text typed stays local (the browser's own undo works inside the cell)
 * and is committed on leaving the cell, Enter or a move key; Ctrl+Z / Ctrl+Y act on the grid only
 * when the cell holds no uncommitted text (AC-RT-04).
 */
const Cell = memo(function Cell({
  rowIndex,
  pos,
  col,
  value,
  column,
  problem,
  label,
  removed,
  handlers,
}: {
  rowIndex: number;
  pos: number;
  col: number;
  value: string;
  column: RefColumn;
  problem: CellProblem | undefined;
  label: string;
  removed: boolean;
  handlers: GridHandlers;
}) {
  const { t } = useTranslation('refTables');
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value);
  }
  const local = parseCell(text, column.type);
  const shown: CellProblem | undefined = !local.ok
    ? local.problem
    : text === value
      ? problem
      : undefined;
  const errorId = `ref-cell-err-${rowIndex}-${col}`;
  const commit = () => {
    if (text !== value) handlers.commit(rowIndex, col, text);
  };

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const grid = input.closest<HTMLElement>('[data-ref-grid]');
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y')) {
      // Typing in progress: the browser undoes the text of this cell.
      if (text !== value) return;
      e.preventDefault();
      if (key === 'y' || e.shiftKey) handlers.redo();
      else handlers.undo();
      return;
    }
    if (e.key === 'Escape' && text !== value) {
      // Back to the committed text; the Escape does not reach a surrounding dialog.
      e.preventDefault();
      e.stopPropagation();
      setText(value);
      return;
    }
    const move = (p: number, c: number) => {
      commit();
      if (focusCell(grid, p, c)) e.preventDefault();
    };
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      focusCell(grid, e.shiftKey ? pos - 1 : pos + 1, col);
    } else if (e.key === 'ArrowDown') move(pos + 1, col);
    else if (e.key === 'ArrowUp') move(pos - 1, col);
    else if (
      e.key === 'ArrowRight' &&
      input.selectionStart === input.value.length &&
      input.selectionEnd === input.value.length
    )
      move(pos, col + 1);
    else if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0)
      move(pos, col - 1);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const data = e.clipboardData.getData('text/plain');
    if (!isMultiCell(data)) return;
    e.preventDefault();
    setText(value);
    handlers.paste(pos, col, data);
  }

  return (
    <td className={cx(denseTdClass, 'px-1 py-1')}>
      <input
        type="text"
        data-pos={pos}
        data-col={col}
        data-cell-problem={shown}
        value={text}
        disabled={removed}
        aria-label={label}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? errorId : undefined}
        title={shown ? t(`grid.problem.${shown}`, { type: t(`types.${column.type}`) }) : undefined}
        autoComplete="off"
        spellCheck={false}
        className={cx(
          cellInputClass,
          shown ? 'border-coral-text bg-coral-tint' : 'border-transparent',
          column.type !== 'string' && 'tabular-nums',
          removed && 'text-muted line-through',
        )}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {shown && (
        <span id={errorId} className="sr-only">
          {t(`grid.problem.${shown}`, { type: t(`types.${column.type}`) })}
        </span>
      )}
    </td>
  );
});

const Row = memo(function Row({
  row,
  index,
  pos,
  columns,
  problems,
  readOnly,
  handlers,
}: {
  row: GridRow;
  index: number;
  pos: number;
  columns: RefColumn[];
  /** Problem per column, joined with "," (a string keeps the memo effective). */
  problems: string;
  readOnly: boolean;
  handlers: GridHandlers;
}) {
  const { t } = useTranslation('refTables');
  const list = problems ? problems.split(',') : [];
  return (
    <tr
      data-grid-row={index}
      data-removed={row.removed || undefined}
      data-new={row.original === null || undefined}
      className={cx(
        row.removed ? 'bg-neutral' : row.original === null ? 'bg-teal-tint' : 'bg-card',
      )}
    >
      <th
        scope="row"
        className={cx(denseTdClass, 'text-right font-normal text-muted tabular-nums')}
      >
        {index + 1}
      </th>
      {columns.map((c, j) =>
        readOnly ? (
          <td key={c.key} className={cx(denseTdClass, c.type !== 'string' && 'tabular-nums')}>
            {row.cells[j]}
          </td>
        ) : (
          <Cell
            key={c.key}
            rowIndex={index}
            pos={pos}
            col={j}
            value={row.cells[j] ?? ''}
            column={c}
            problem={(list[j] || undefined) as CellProblem | undefined}
            label={t('grid.cellLabel', { column: c.title, row: index + 1 })}
            removed={row.removed}
            handlers={handlers}
          />
        ),
      )}
      {!readOnly && (
        <td className={cx(denseTdClass, 'sticky right-0 bg-inherit px-2 py-1 text-right')}>
          <RowIcon label={row.removed ? t('grid.restore') : t('grid.remove')}>
            <button
              type="button"
              aria-label={t(row.removed ? 'grid.restoreRow' : 'grid.removeRow', { row: index + 1 })}
              className={cx(rowIconClass, row.removed ? 'hover:text-ink' : 'hover:text-coral-text')}
              onClick={() => handlers.toggle(index)}
            >
              {row.removed ? <UndoIcon /> : <TrashIcon />}
            </button>
          </RowIcon>
        </td>
      )}
    </tr>
  );
});

/**
 * Data grid of a version (spec §34 AC-RT-04): a table of text inputs (each named "column, row
 * n"), dense 14px like the data preview tables; read-only versions show plain cells. Moves: ↑ ↓
 * Enter (Shift+Enter up), ← → at the edge of the text, Tab in reading order.
 */
export function DataGrid({
  columns,
  rows,
  visible,
  problems,
  readOnly,
  handlers,
  label,
}: {
  columns: RefColumn[];
  rows: GridRow[];
  /** Row indexes drawn, in order (search applied, current batch only). */
  visible: number[];
  problems: Map<string, CellProblem>;
  readOnly: boolean;
  handlers: GridHandlers;
  label: string;
}) {
  const { t } = useTranslation('refTables');
  const typeLabel = useTypeLabel();
  const rowProblems = (i: number) =>
    problems.size === 0 ? '' : columns.map((_, j) => problems.get(`${i}:${j}`) ?? '').join(',');
  return (
    <div data-ref-grid className="overflow-x-auto" role="region" tabIndex={-1} aria-label={label}>
      <table className="w-full border-collapse text-dense text-ink-soft">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col" className={cx(denseThClass, 'text-right')}>
              {t('grid.rowNo')}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={denseThClass}>
                <span className="flex items-center gap-2">
                  {c.title}
                  {c.isKey && <Chip tone="blue">{t('keyChip')}</Chip>}
                </span>
                <span className="block font-mono font-normal">{typeLabel(c.type)}</span>
              </th>
            ))}
            {!readOnly && (
              <th scope="col" className={cx(denseThClass, 'sticky right-0 text-right')}>
                {t('grid.actions')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {visible.map((i, pos) => (
            <Row
              key={rows[i]!.id}
              row={rows[i]!}
              index={i}
              pos={pos}
              columns={columns}
              problems={rowProblems(i)}
              readOnly={readOnly}
              handlers={handlers}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

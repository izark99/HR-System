import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreIcon } from './icons';
import { MenuButton, type MenuItem } from './Menu';
import { Tooltip } from './Tooltip';
import { orderMenuItems } from './menu-logic';
import { buttonClass, cx, thClass } from './ui';

/**
 * Shared "Thao tác" cell of every Admin table (spec §25.3 "Thao tác trên dòng bảng", AC-UI-54):
 * the frequent action(s) as small buttons, then "Thao tác khác ▾" opening a menu with the rest
 * (destructive items last, coral). One line, right-aligned, so the menu buttons line up in a
 * column across rows whatever the visible buttons are.
 */
export function RowActions({
  rowName,
  visible,
  items,
}: {
  /** Name of the row read out by the menu button ("Thao tác khác cho hr.nv01"). */
  rowName: string;
  visible?: ReactNode;
  items: MenuItem[];
}) {
  const { t } = useTranslation();
  // Destructive items always come last, after a separator.
  const ordered = orderMenuItems(items);
  return (
    <div data-row-actions className="flex items-center justify-end gap-2 whitespace-nowrap">
      {visible}
      {ordered.length > 0 && (
        <MenuButton
          label={t('common.moreActions')}
          ariaLabel={t('common.moreActionsFor', { name: rowName })}
          items={ordered}
          icon={<MoreIcon />}
        />
      )}
    </div>
  );
}

/**
 * Cell classes for the action column: no wrap, vertically centred, and pinned to the right edge
 * of the scrolling table region (sticky), so the actions stay in view when a narrow card makes
 * the other columns scroll. The cell takes the row background (`bg-inherit`): rows must set one
 * (`bg-card` or a tint).
 */
export const rowActionsCellClass =
  'sticky right-0 border-b border-line bg-inherit px-4 py-2 align-middle whitespace-nowrap ' +
  // Separator drawn by the cell itself: a collapsed-table border stays behind when the cell sticks.
  'before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-line ' +
  // A sticky cell is a stacking context: lift the one holding an open menu above the next rows.
  'has-[[role=menu]]:z-20 has-[[data-tooltip]]:z-20';

/** Header cell of the action column (right-aligned and pinned like the cells). */
export const rowActionsHeadClass = cx(
  thClass.replace('text-left', 'text-right'),
  'sticky right-0',
  'before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-line',
);

/** Icon-only row action (AC-UI-58): 36x36 text-style button, ink icon, hover neutral. */
export const rowIconClass = cx(buttonClass('text', 'sm'), 'w-control-sm px-0! no-underline');

/** Tooltip around a row icon action; `label` is the visible-on-hover name of the action. */
export function RowIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip text={label} className="inline-flex">
      {children}
    </Tooltip>
  );
}

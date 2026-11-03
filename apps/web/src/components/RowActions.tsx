import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuButton, type MenuItem } from './Menu';
import { orderMenuItems } from './menu-logic';
import { cx, thClass } from './ui';

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
  'sticky right-0 border-b border-l border-line bg-inherit px-4 py-2 align-middle whitespace-nowrap ' +
  // A sticky cell is a stacking context: lift the one holding an open menu above the next rows.
  'has-[[role=menu]]:z-20';

/** Header cell of the action column (right-aligned and pinned like the cells). */
export const rowActionsHeadClass = cx(
  thClass.replace('text-left', 'text-right'),
  'sticky right-0 border-l',
);

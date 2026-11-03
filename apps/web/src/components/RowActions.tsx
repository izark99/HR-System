import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuButton, type MenuItem } from './Menu';
import { orderMenuItems } from './menu-logic';
import { thClass } from './ui';

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

/** Cell classes for the action column: no wrap, vertically centred, right-aligned. */
export const rowActionsCellClass = 'border-b border-line px-4 py-2 align-middle whitespace-nowrap';

/** Header cell of the action column (right-aligned like the cells). */
export const rowActionsHeadClass = thClass.replace('text-left', 'text-right');

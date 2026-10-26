import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MONTH_COLUMNS,
  moveMonth,
  monthValue,
  parseMonthValue,
  todayYmd,
  type YearMonth,
} from './calendar';
import {
  CalendarIcon,
  cellClass,
  ChevronIcon,
  footerButtonClass,
  navButtonClass,
  PickerPanel,
  triggerClass,
  usePickerPopover,
} from './picker-shared';
import { cx } from './ui';

export interface PickerProps {
  /** id of the trigger button (target of the field's `<label htmlFor>`). */
  id: string;
  /** id of the visible label element; names the dialog. */
  labelId: string;
  /** ISO value (`YYYY-MM` here) or '' when empty. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * Month picker (spec §25): a real button showing "Tháng 10/2026", opening a non-modal dialog with
 * a year header and a 4×3 month grid (roving tabindex; arrows, Home/End, PageUp/PageDown = year,
 * Enter/Space select, Escape closes and returns focus).
 */
export function MonthPicker({ id, labelId, value, onChange, required, disabled }: PickerProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { open, setOpen, close, shift, rootRef } = usePickerPopover(triggerRef);
  const selected = parseMonthValue(value);
  const now = todayYmd();
  const [active, setActive] = useState<YearMonth>(selected ?? now);
  const focusGrid = useRef(false);
  const valueId = useId();
  const yearId = useId();

  useEffect(() => {
    if (!open || !focusGrid.current) return;
    focusGrid.current = false;
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [open, active]);

  function toggle() {
    if (open) {
      close(false);
      return;
    }
    setActive(selected ?? { year: now.year, month: now.month });
    focusGrid.current = true;
    setOpen(true);
  }

  function pick(ym: YearMonth) {
    onChange(monthValue(ym));
    close(true);
  }

  function onGridKey(e: KeyboardEvent) {
    const next = moveMonth(active, e.key);
    if (!next) return;
    e.preventDefault();
    focusGrid.current = true;
    setActive(next);
  }

  const label = selected
    ? t('picker.monthValue', {
        month: String(selected.month).padStart(2, '0'),
        year: selected.year,
      })
    : t('picker.chooseMonth');

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-required={required || undefined}
        onClick={toggle}
        className={triggerClass}
      >
        <span id={valueId} className={cx(!selected && 'text-muted')}>
          {label}
        </span>
        <CalendarIcon className="shrink-0 text-teal-strong" />
      </button>

      {open && (
        <PickerPanel labelledBy={labelId} shift={shift} onClose={close} rootRef={rootRef}>
          <div className="flex items-center justify-between">
            <button
              type="button"
              className={navButtonClass}
              aria-label={t('picker.prevYear')}
              onClick={() => setActive((a) => ({ ...a, year: a.year - 1 }))}
            >
              <ChevronIcon dir="left" />
            </button>
            <span id={yearId} aria-live="polite" className="text-section text-ink">
              {active.year}
            </span>
            <button
              type="button"
              className={navButtonClass}
              aria-label={t('picker.nextYear')}
              onClick={() => setActive((a) => ({ ...a, year: a.year + 1 }))}
            >
              <ChevronIcon dir="right" />
            </button>
          </div>

          <div
            ref={gridRef}
            role="grid"
            aria-labelledby={yearId}
            onKeyDown={onGridKey}
            className="flex flex-col gap-1.5"
          >
            {[0, 1, 2].map((row) => (
              <div key={row} role="row" className="grid grid-cols-4 gap-1.5">
                {MONTHS.slice(row * MONTH_COLUMNS, row * MONTH_COLUMNS + MONTH_COLUMNS).map((m) => {
                  const isSelected = selected?.year === active.year && selected.month === m;
                  const isCurrent = now.year === active.year && now.month === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="gridcell"
                      aria-selected={isSelected}
                      aria-current={isCurrent ? 'date' : undefined}
                      aria-label={t('picker.monthCell', { month: m, year: active.year })}
                      tabIndex={active.month === m ? 0 : -1}
                      onClick={() => pick({ year: active.year, month: m })}
                      onFocus={() => setActive((a) => (a.month === m ? a : { ...a, month: m }))}
                      className={cellClass(isSelected, isCurrent)}
                    >
                      {t('picker.monthShort', { month: m })}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-line pt-2">
            <button
              type="button"
              className={footerButtonClass}
              onClick={() => pick({ year: now.year, month: now.month })}
            >
              {t('picker.thisMonth')}
            </button>
            {!required && (
              <button
                type="button"
                className={footerButtonClass}
                onClick={() => {
                  onChange('');
                  close(true);
                }}
              >
                {t('picker.clear')}
              </button>
            )}
          </div>
        </PickerPanel>
      )}
    </div>
  );
}

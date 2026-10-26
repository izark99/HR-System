import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addMonthsToDate,
  dateValue,
  monthWeeks,
  moveDate,
  parseDateValue,
  todayYmd,
  type Ymd,
} from './calendar';
import type { PickerProps } from './MonthPicker';
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

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Date picker (spec §25), same building blocks as MonthPicker: trigger shows dd/MM/yyyy; dialog
 * with month/year header and a Monday-first 7-column grid (arrows, Home/End = week,
 * PageUp/PageDown = month, Shift+PageUp/PageDown = year, Enter/Space select, Escape closes).
 */
export function DatePicker({ id, labelId, value, onChange, required, disabled }: PickerProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { open, setOpen, close, shift, rootRef } = usePickerPopover(triggerRef);
  const selected = parseDateValue(value);
  const today = todayYmd();
  const [active, setActive] = useState<Ymd>(selected ?? today);
  const focusGrid = useRef(false);
  const valueId = useId();
  const titleId = useId();

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
    setActive(selected ?? today);
    focusGrid.current = true;
    setOpen(true);
  }

  function pick(d: Ymd) {
    onChange(dateValue(d));
    close(true);
  }

  function onGridKey(e: KeyboardEvent) {
    const next = moveDate(active, e.key, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    focusGrid.current = true;
    setActive(next);
  }

  const same = (a: Ymd | null, y: number, m: number, d: number) =>
    !!a && a.year === y && a.month === m && a.day === d;

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
          {selected
            ? `${pad(selected.day)}/${pad(selected.month)}/${selected.year}`
            : t('picker.chooseDate')}
        </span>
        <CalendarIcon className="shrink-0 text-teal-strong" />
      </button>

      {open && (
        <PickerPanel labelledBy={labelId} shift={shift} onClose={close} rootRef={rootRef}>
          <div className="flex items-center justify-between">
            <button
              type="button"
              className={navButtonClass}
              aria-label={t('picker.prevMonth')}
              onClick={() => setActive((a) => addMonthsToDate(a, -1))}
            >
              <ChevronIcon dir="left" />
            </button>
            <span id={titleId} aria-live="polite" className="text-section text-ink">
              {t('picker.monthYear', { month: active.month, year: active.year })}
            </span>
            <button
              type="button"
              className={navButtonClass}
              aria-label={t('picker.nextMonth')}
              onClick={() => setActive((a) => addMonthsToDate(a, 1))}
            >
              <ChevronIcon dir="right" />
            </button>
          </div>

          <div ref={gridRef} role="grid" aria-labelledby={titleId} onKeyDown={onGridKey}>
            <div role="row" className="grid grid-cols-7">
              {WEEKDAYS.map((w) => (
                <span
                  key={w}
                  role="columnheader"
                  aria-label={t(`picker.weekdayLong.${w}`)}
                  className="py-1 text-center text-small font-semibold text-muted"
                >
                  {t(`picker.weekday.${w}`)}
                </span>
              ))}
            </div>
            {monthWeeks(active.year, active.month).map((week, wi) => (
              <div key={wi} role="row" className="grid grid-cols-7">
                {week.map((day, di) =>
                  day === null ? (
                    <span key={di} role="gridcell" aria-hidden />
                  ) : (
                    <button
                      key={di}
                      type="button"
                      role="gridcell"
                      aria-selected={same(selected, active.year, active.month, day)}
                      aria-current={
                        same(today, active.year, active.month, day) ? 'date' : undefined
                      }
                      aria-label={t('picker.dayCell', {
                        day,
                        month: active.month,
                        year: active.year,
                      })}
                      tabIndex={active.day === day ? 0 : -1}
                      onClick={() => pick({ year: active.year, month: active.month, day })}
                      onFocus={() => setActive((a) => (a.day === day ? a : { ...a, day }))}
                      className={cx(
                        cellClass(
                          same(selected, active.year, active.month, day),
                          same(today, active.year, active.month, day),
                        ),
                        'min-w-0',
                      )}
                    >
                      {day}
                    </button>
                  ),
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-line pt-2">
            <button type="button" className={footerButtonClass} onClick={() => pick(today)}>
              {t('picker.today')}
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

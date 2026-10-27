import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { panelShift } from './picker-shared';
import {
  filterSections,
  flatten,
  SEARCH_THRESHOLD,
  sectionsOf,
  typeAheadIndex,
  type SelectGroup,
  type SelectOption,
} from './select-logic';
import { CheckIcon, cx } from './ui';

export type { SelectGroup, SelectOption } from './select-logic';

export interface SelectProps {
  /** id of the trigger (target of the field's `<label htmlFor>`, which names it). */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Options without a group (shown first). */
  options?: SelectOption[];
  /** Groups with an eyebrow header (e.g. "Nhóm" / "Tài khoản"). */
  groups?: SelectGroup[];
  /** Trigger text when no option matches `value`. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  /** Extra classes for the trigger (width). */
  className?: string;
}

const TYPEAHEAD_RESET_MS = 700;
const PANEL_MIN_WIDTH = 240;

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Dropdown (spec §25.3 "Select (dropdown)", MEMORY 2026-10-27 17:50): replaces the browser's
 * `<select>`. APG "select-only combobox": the trigger is a button with role combobox; the popup
 * is a listbox (options grouped under eyebrow headers). DOM focus stays on the trigger (or on the
 * search box when there are more than 8 options) and the active option is announced through
 * `aria-activedescendant`.
 *
 * Keys: ArrowDown/ArrowUp/Enter/Space open; in the list ArrowDown/ArrowUp/Home/End/PageDown/
 * PageUp move, Enter (or Space without search) selects, Escape closes without changing the value
 * (and never closes a surrounding modal dialog), Tab closes; typing jumps to a matching option
 * (or filters, with search). Works inside a modal `<dialog>` (the popup is part of the dialog's
 * top layer, positioned under the trigger).
 */
export function Select({
  id,
  value,
  onChange,
  options,
  groups,
  placeholder,
  disabled,
  required,
  invalid,
  className,
}: SelectProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [shift, setShift] = useState(0);
  // The listbox is named like the field: the text of the trigger's <label for>.
  const [listLabel, setListLabel] = useState<string | undefined>(undefined);
  const typed = useRef({ text: '', at: 0 });

  const sections = useMemo(() => sectionsOf(options, groups), [options, groups]);
  const all = useMemo(() => flatten(sections), [sections]);
  const searchable = all.length > SEARCH_THRESHOLD;
  const shown = useMemo(
    () => (searchable ? filterSections(sections, query) : sections),
    [sections, query, searchable],
  );
  const shownFlat = useMemo(() => flatten(shown), [shown]);
  const selected = all.find((o) => o.value === value);
  const optionId = (i: number) => `${listId}-o${i}`;

  function openList(at?: number) {
    if (disabled) return;
    setQuery('');
    const sel = all.findIndex((o) => o.value === value);
    setActive(at ?? (sel >= 0 ? sel : 0));
    setOpen(true);
  }

  function close(focusTrigger: boolean) {
    setOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  }

  function choose(i: number) {
    const o = shownFlat[i];
    if (!o) return;
    if (o.value !== value) onChange(o.value);
    close(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    setListLabel(triggerRef.current?.labels?.[0]?.textContent?.trim() || undefined);
    if (rect) {
      setShift(panelShift(rect.left, window.innerWidth, Math.max(rect.width, PANEL_MIN_WIDTH)));
    }
    if (searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // Outside pointer closes; a modal dialog's close request while open closes the list only.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    const onCancel = (e: Event) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && e.target.contains(root)) {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('cancel', onCancel, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('cancel', onCancel, true);
    };
  });

  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`);
    el?.scrollIntoView?.({ block: 'nearest' });
    // optionId depends on listId only (stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function typeAhead(ch: string, list: readonly SelectOption[], from: number): number {
    const now = Date.now();
    const buf = now - typed.current.at > TYPEAHEAD_RESET_MS ? ch : typed.current.text + ch;
    typed.current = { text: buf, at: now };
    return typeAheadIndex(list, buf, from);
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (disabled) return;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      } else if (printable && !searchable) {
        e.preventDefault();
        const sel = all.findIndex((o) => o.value === value);
        const i = typeAhead(e.key, all, sel);
        openList(i >= 0 ? i : undefined);
      }
      return;
    }
    const last = shownFlat.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, i)));
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(active + 1);
      case 'ArrowUp':
        return move(active - 1);
      case 'Home':
      case 'End':
        // In the search box Home/End move the text cursor (APG combobox with an editable input).
        if (e.currentTarget === searchRef.current) return;
        return move(e.key === 'Home' ? 0 : last);
      case 'PageDown':
        return move(active + 10);
      case 'PageUp':
        return move(active - 10);
      case 'Enter':
        e.preventDefault();
        return choose(active);
      case 'Escape':
        // preventDefault: inside a modal <dialog> Escape must close only the list.
        e.preventDefault();
        e.stopPropagation();
        return close(true);
      case 'Tab':
        return close(false);
      default:
        if (e.key === ' ' && !searchable) {
          e.preventDefault();
          return choose(active);
        }
        if (printable && !searchable) {
          e.preventDefault();
          const i = typeAhead(e.key, shownFlat, active);
          if (i >= 0) setActive(i);
        }
    }
  }

  let index = -1;
  return (
    <div ref={rootRef} className="relative inline-flex flex-col">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !searchable && active >= 0 ? optionId(active) : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        data-value={value}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (open && next && !rootRef.current?.contains(next)) close(false);
        }}
        className={cx(
          'inline-flex h-target min-w-48 items-center justify-between gap-3 rounded-control border bg-card px-3.5 text-left text-label text-ink',
          'hover:border-teal-strong disabled:cursor-not-allowed disabled:bg-neutral disabled:text-muted',
          invalid ? 'border-2 border-coral' : 'border-line-input',
          className,
        )}
      >
        <span className={cx('truncate', !selected && 'text-muted')}>
          {selected ? selected.label : (placeholder ?? t('select.placeholder'))}
        </span>
        <ChevronDown
          className={cx('shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          style={{
            left: shift,
            minWidth: `min(${PANEL_MIN_WIDTH}px, calc(100vw - 24px))`,
            maxWidth: 'calc(100vw - 24px)',
          }}
          className="absolute top-full z-50 mt-1.5 flex w-full flex-col gap-1.5 rounded-tile bg-card p-2 shadow-card"
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && !rootRef.current?.contains(next)) close(false);
          }}
        >
          {searchable && (
            <input
              ref={searchRef}
              type="search"
              aria-label={t('select.search')}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                active >= 0 && shownFlat[active] ? optionId(active) : undefined
              }
              placeholder={t('select.search')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-10.5 rounded-control border border-line-input bg-card px-3 text-label"
            />
          )}
          {/* Outside the listbox: a listbox may only contain options and groups. */}
          {shownFlat.length === 0 && (
            <p role="status" className="m-0 px-3 py-2.5 text-small text-muted">
              {t('select.noResults')}
            </p>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={listLabel}
            tabIndex={-1}
            className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
          >
            {shown.map((section, s) => {
              const headerId = `${listId}-g${s}`;
              const items = section.options.map((o) => {
                index++;
                const i = index;
                const isSelected = o.value === value;
                return (
                  <div
                    key={`${s}-${o.value}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    onPointerMove={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()} // keep focus on the trigger
                    onClick={() => choose(i)}
                    className={cx(
                      'flex min-h-target cursor-pointer items-center justify-between gap-3 rounded-control px-3 text-label',
                      isSelected ? 'bg-teal-tint font-semibold text-teal-strong' : 'text-body',
                      i === active && !isSelected && 'bg-neutral',
                      i === active && 'ring-2 ring-teal-strong ring-inset',
                    )}
                  >
                    <span className="min-w-0 break-words">{o.label || ' '}</span>
                    {isSelected && <CheckIcon className="shrink-0" />}
                  </div>
                );
              });
              return section.label ? (
                <div
                  key={headerId}
                  role="group"
                  aria-labelledby={headerId}
                  className="flex flex-col gap-0.5"
                >
                  <div
                    id={headerId}
                    role="presentation"
                    className="px-3 pt-2 pb-1 text-eyebrow text-muted uppercase"
                  >
                    {section.label}
                  </div>
                  {items}
                </div>
              ) : (
                <div key={`plain-${s}`} role="presentation" className="flex flex-col gap-0.5">
                  {items}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { menuKeyTarget } from './menu-logic';
import { buttonClass, cx, floatClass } from './ui';

export interface MenuItem {
  /** Stable key (also used in tests through `data-menu-item`). */
  key: string;
  /** Visible text. */
  label: string;
  /** Accessible name when it should say more than the label (it must contain the label). */
  ariaLabel?: string;
  onSelect: () => void;
  /** Destructive action (Khóa, Retire, Hủy draft, Xóa): coral text, placed last by the caller. */
  danger?: boolean;
  disabled?: boolean;
}

const MARGIN = 8;
const GAP = 4;

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Menu button following the WAI-ARIA APG "menu button" pattern (spec §25.3 "Thao tác trên dòng
 * bảng"): Enter / Space / ArrowDown open the menu on the first item, ArrowUp on the last; inside
 * the menu ArrowUp/ArrowDown move (wrapping), Home/End jump, Escape closes and returns focus to
 * the button, Tab closes and lets focus move on. Choosing an item closes the menu, puts focus
 * back on the button (so a dialog opened by the item returns focus there) and runs the item.
 *
 * The popover is a level-2 layer (radius 12px + float shadow) positioned `fixed`, so the
 * scrolling table region around it does not clip it.
 */
export function MenuButton({
  label,
  ariaLabel,
  items,
}: {
  label: string;
  ariaLabel: string;
  items: MenuItem[];
}) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const place = useCallback(() => {
    const b = buttonRef.current?.getBoundingClientRect();
    const m = menuRef.current;
    if (!b || !m) return;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    let top = b.bottom + GAP;
    if (top + h > window.innerHeight - MARGIN && b.top - h - GAP >= MARGIN) top = b.top - h - GAP;
    // Right-aligned with the button (the action column is the last one), kept in the viewport.
    const left = Math.max(MARGIN, Math.min(b.right - w, window.innerWidth - w - MARGIN));
    m.style.top = `${top}px`;
    m.style.left = `${left}px`;
  }, []);

  // Placed straight on the element before paint, then the active item takes focus.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus({ preventScroll: true });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openAt(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(items.length - 1);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    const next = menuKeyTarget(e.key, active, items.length);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  const firstDanger = items.findIndex((i) => i.danger);

  return (
    <span className="inline-flex">
      <button
        ref={buttonRef}
        type="button"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={ariaLabel}
        data-menu-button
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onButtonKey}
        className={cx(buttonClass('text', 'sm'), 'gap-1')}
      >
        {label}
        <ChevronDownIcon />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-button`}
          onKeyDown={onMenuKey}
          className={cx(floatClass, 'fixed top-0 left-0 z-50 flex min-w-56 flex-col p-1.5')}
        >
          {items.map((item, i) => (
            <Fragment key={item.key}>
              {i === firstDanger && i > 0 && (
                <div role="separator" className="mx-2 my-1 border-t border-line" />
              )}
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-menu-item={item.key}
                aria-label={item.ariaLabel}
                aria-disabled={item.disabled || undefined}
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  'flex min-h-target w-full items-center rounded-input px-3 text-left text-body whitespace-nowrap',
                  'focus:bg-neutral focus:outline-none hover:bg-neutral',
                  'focus-visible:ring-2 focus-visible:ring-teal-strong focus-visible:ring-inset',
                  item.disabled
                    ? 'cursor-not-allowed text-muted'
                    : item.danger
                      ? 'font-semibold text-coral-text'
                      : 'text-ink',
                )}
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </span>
  );
}

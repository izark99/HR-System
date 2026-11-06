import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { cx, floatClass } from './ui';

const GAP = 6;
const MARGIN = 8;

/**
 * Hover/focus tooltip (spec §25.3, level-2 layer). Shown while the pointer is over the wrapped
 * content or it has keyboard focus; Escape hides it (WCAG 1.4.13). The text is a visual aid only
 * (`aria-hidden`): the wrapped control must already carry the same text in its accessible name.
 *
 * Positioned `fixed` so it is not clipped by scrolling containers (palette, table regions).
 * `text = null` disables it while keeping the same element tree (no remount of the content).
 */
export function Tooltip({
  text,
  children,
  className,
  as: Wrapper = 'span',
}: {
  text: string | null;
  children: ReactNode;
  className?: string;
  /** `div` when the anchor wraps block content (e.g. an `<h1>`): a span may not contain it. */
  as?: 'span' | 'div';
}) {
  const anchor = useRef<HTMLElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const visible = open && text !== null;

  // Placed straight on the element before paint (no state round-trip).
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = tip.current;
    if (!visible || !a || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = a.bottom + GAP;
    if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - h - GAP);
    const left = Math.max(MARGIN, Math.min(a.left, window.innerWidth - w - MARGIN));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [visible, text]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  const onFocus = (e: FocusEvent) => {
    // Keyboard focus only: a mouse click already showed it on hover.
    if ((e.target as HTMLElement).matches?.(':focus-visible')) setOpen(true);
  };

  return (
    <Wrapper
      ref={anchor as never}
      className={cx('relative', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={onFocus}
      onBlur={() => setOpen(false)}
    >
      {children}
      {visible && (
        <span
          ref={tip}
          aria-hidden
          data-tooltip
          className={cx(
            floatClass,
            'pointer-events-none fixed z-50 block w-max max-w-80 px-3 py-2',
            'top-0 left-0 text-left text-caption font-normal tracking-normal whitespace-normal text-ink normal-case',
          )}
        >
          {text}
        </span>
      )}
    </Wrapper>
  );
}

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { InfoIcon } from './icons';
import { cx, floatClass } from './ui';

const GAP = 4;
const MARGIN = 8;

/**
 * The one (i) popover open on the page (AC-UI-78 rule 18): opening another one (hover, focus or a
 * click) closes it. Module store, no context needed.
 */
let openTip: string | null = null;
const listeners = new Set<() => void>();
function setOpenTip(id: string | null) {
  if (openTip === id) return;
  openTip = id;
  listeners.forEach((l) => l());
}

/**
 * "(i)" button that holds a hint / explanation instead of a paragraph shown under a field or a
 * heading (spec §25.5 "InfoTip", MEMORY 2026-11-06 14:45). 20px icon in a 44px target; the target
 * reaches 12px above and below the line (`-my-3`), so a label row stays one line high.
 *
 * Opens on mouse hover, keyboard focus or a click / tap (a click pins it open); Escape or a click
 * outside closes it. The popover is a level-2 layer placed `fixed` under the button (above it when
 * there is no room) and kept inside the viewport, so a scrolling panel cannot clip it.
 *
 * The text is always in the DOM as screen-reader text with id `id`: the button is described by it,
 * and a field points its control's `aria-describedby` at the same id (AC-UI-66). The visible copy
 * in the popover is `aria-hidden` so it is not read twice. Hint text carries `data-hint`
 * (AC-UI-78 rule 14: a hint is never shown as a paragraph).
 */
export function InfoTip({
  label,
  id,
  children,
  className,
}: {
  /** What the hint explains: the button is named "Giải thích: <label>". */
  label: string;
  /** id of the screen-reader copy of the text (default: generated). */
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const generated = useId();
  const textId = id ?? `${generated}-text`;
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;
  const close = () => {
    setHover(false);
    setFocus(false);
    setPinned(false);
  };

  // One popover at a time: claim the store when opening, close when another one claims it.
  useEffect(() => {
    if (!open) return;
    setOpenTip(textId);
    const onChange = () => {
      if (openTip !== textId) {
        setHover(false);
        setFocus(false);
        setPinned(false);
      }
    };
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
      if (openTip === textId) setOpenTip(null);
    };
  }, [open, textId]);

  // Placed straight on the element before paint, again when a panel scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      // Anchored on the painted icon (it sits at the start of the 44px target).
      const a = (button.current?.querySelector('svg') ?? button.current)?.getBoundingClientRect();
      const el = pop.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let top = a.bottom + GAP;
      if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - h - GAP);
      const left = Math.max(
        MARGIN,
        Math.min(a.left + a.width / 2 - 14, window.innerWidth - w - MARGIN),
      );
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Inside a modal <dialog> Escape closes only the popover (like Select): preventDefault on
      // the keydown keeps the dialog's "cancel" from firing; a second Escape closes the dialog.
      e.preventDefault();
      close();
    };
    const onDown = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    // Belt and braces: a dialog's "cancel" while a popover is open is not the dialog's Escape.
    const onCancel = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('cancel', onCancel, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('cancel', onCancel, true);
    };
  }, [open]);

  const mouse = (e: PointerEvent) => e.pointerType === 'mouse';
  return (
    <span
      ref={wrap}
      data-infotip
      className={cx('inline-flex shrink-0', className)}
      onPointerEnter={(e) => mouse(e) && setHover(true)}
      onPointerLeave={(e) => mouse(e) && setHover(false)}
    >
      <button
        ref={button}
        type="button"
        data-infotip-button
        aria-label={t('common.infoTip', { label })}
        aria-describedby={textId}
        aria-expanded={open}
        onClick={() => {
          if (pinned) close();
          else setPinned(true);
        }}
        onFocus={(e) => {
          // Keyboard focus only: a click already pins it.
          if (e.currentTarget.matches(':focus-visible')) setFocus(true);
        }}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
        }}
        className={cx(
          // The icon sits 4px after the text it explains (AC-UI-78 rule 17: ≤ 8px), the rest of
          // the target trails after it.
          '-my-3 inline-flex size-target shrink-0 items-center justify-start rounded-card pl-1',
          // No hover fill: the target reaches over the line above and below (only the icon shows).
          'text-muted hover:text-ink',
          open && 'text-teal-strong',
        )}
      >
        <InfoIcon size={20} />
      </button>
      <span id={textId} data-hint className="sr-only">
        {children}
      </span>
      {open && (
        <span
          ref={pop}
          aria-hidden
          data-hint
          data-infotip-pop
          className={cx(
            floatClass,
            'fixed top-0 left-0 z-50 block w-max max-w-[min(320px,calc(100vw-16px))] px-3 py-2',
            'text-left text-caption font-normal tracking-normal whitespace-normal text-ink normal-case',
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}

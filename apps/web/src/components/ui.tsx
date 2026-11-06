import {
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Tooltip } from './Tooltip';

/** Small set of primitives implementing spec §25.3 on top of the theme tokens in index.css. */

export type Tone = 'teal' | 'coral' | 'amber' | 'blue' | 'neutral';

export const toneText: Record<Tone, string> = {
  teal: 'text-teal-strong',
  coral: 'text-coral-text',
  amber: 'text-amber-text',
  blue: 'text-blue-text',
  neutral: 'text-ink-soft',
};

export const toneTint: Record<Tone, string> = {
  teal: 'bg-teal-tint',
  coral: 'bg-coral-tint',
  amber: 'bg-amber-tint',
  blue: 'bg-blue-tint',
  neutral: 'bg-neutral',
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Level-1 surface (§25.3): white, 12px radius, 1px #E2E8F0 border, no shadow. */
export const cardClass = 'rounded-card border border-line bg-card';

/** Level-2 floating layer: popover, menu, dialog, toast. */
export const floatClass = 'rounded-card border border-line bg-card shadow-float';

/**
 * Text-like control (§25.3 Input): 44px, 6px radius, 1px #475569 border, `body`; focus = teal
 * border + 3px #DDF5EF ring; `aria-invalid` = coral border.
 */
const inputFrame =
  'min-w-0 rounded-input border border-line-input bg-card px-3.5 text-body text-ink ' +
  'focus:border-teal-strong focus:ring-3 focus:ring-teal-tint focus:outline-none ' +
  'aria-invalid:border-coral-text disabled:bg-neutral disabled:text-muted';
export const inputClass = `h-control ${inputFrame}`;
/** Multi-line variant of `inputClass` (height from `rows`). */
export const textareaClass = `py-2.5 ${inputFrame}`;

/**
 * Dense variant for the Designer side form (MEMORY 2026-10-30 13:29: 14px text there); same frame
 * (radius, border, focus) as `inputClass`.
 */
export const denseInputClass =
  'h-10.5 min-w-0 rounded-input border border-line-input bg-card px-3 text-dense text-ink ' +
  'focus:border-teal-strong focus:ring-3 focus:ring-teal-tint focus:outline-none ' +
  'aria-invalid:border-coral-text disabled:bg-neutral disabled:text-muted';

/**
 * Left-menu item (§25.3 "Menu trái"): 44px, 6px radius; the current item has a teal tint, teal
 * 600 text and a 3px teal bar on the left.
 */
export function navItemClass(active: boolean): string {
  return cx(
    'flex min-h-target items-center rounded-input border-l-3 px-3.5 text-body whitespace-nowrap no-underline',
    active
      ? 'border-teal-strong bg-teal-tint font-semibold text-teal-strong hover:text-teal-strong'
      : 'border-transparent text-ink-soft hover:bg-neutral hover:text-ink',
  );
}

/** Pill tab / filter toggle (§25.3 "Tab"): the selected one has a tint and strong text. */
export function pillClass(selected: boolean): string {
  return cx(
    'inline-flex min-h-target items-center rounded-pill px-4 text-body',
    selected
      ? 'bg-teal-tint font-semibold text-teal-strong'
      : 'border border-line-input bg-card text-ink-soft hover:bg-neutral',
  );
}

/** Form label (§25.1 `label`: 16px / 600). */
export const labelClass = 'text-label text-ink';

/** Table header cell of an admin/user table (§25.3: `caption` 600 #475569 on #F1F5F9). */
export const thClass =
  'border-b border-line bg-neutral px-4 py-3 text-left text-caption font-semibold whitespace-nowrap text-muted';

/** Body cell of a table (12px 16px padding; type size and colour come from the `<table>`). */
export const tdClass = 'border-b border-line px-4 py-3 align-top';

/**
 * Admin table cell (AC-UI-57): one line, vertically centred, so every row has the same height.
 * Text is never cut: columns size to their content and a table wider than its card scrolls
 * sideways inside its region, with the action column pinned to the right edge.
 */
export const tdLineClass = 'border-b border-line px-4 py-3 align-middle whitespace-nowrap';

/** Header cell of an admin table: one line, full text. */
export const thLineClass = thClass;

/** One-line cell text, shown in full (line breaks of change notes collapse into spaces). */
export function CellText({ text, className }: { text: string; className?: string }) {
  return <span className={className}>{text.replace(/\s+/g, ' ').trim()}</span>;
}

/** Cell holding row actions (small buttons): tighter vertical padding. */
export const tdActionClass = 'border-b border-line px-2 py-1 align-middle';

const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-card whitespace-nowrap ' +
  // Colors animate only for hover/press. A disabled→enabled change must snap: a fade would leave
  // white text on a pale mid-transition teal (contrast below WCAG AA) for a moment.
  'transition-none hover:transition-colors active:transition-colors disabled:cursor-not-allowed';

/** Height + type per size (§25.3): md 44px / `button`, sm 36px / `button-sm` (tables, toolbars). */
export const buttonSize = {
  md: 'min-h-control px-6 text-button',
  sm: 'min-h-control-sm px-4 text-button-sm',
} as const;

export type ButtonVariant = 'primary' | 'dark' | 'outline' | 'text' | 'danger';
export type ButtonSize = keyof typeof buttonSize;

/** Colors per variant (§25.3). White text only on #0F766E and #1F2A44 (WCAG AA). */
const buttonTone: Record<ButtonVariant, string> = {
  primary: 'bg-teal-strong text-white hover:bg-teal-hover disabled:bg-line disabled:text-muted',
  dark: 'bg-ink text-white hover:bg-ink-soft disabled:bg-line disabled:text-muted',
  outline:
    'border border-ink bg-card text-ink hover:bg-neutral disabled:border-line-input disabled:text-muted',
  text: 'bg-transparent text-ink hover:bg-neutral disabled:text-muted',
  danger:
    'border border-coral-text bg-card text-coral-text hover:bg-coral-tint disabled:border-line-input disabled:text-muted',
};

/** Class string of a button-looking element (also for `<Link>`/`<a>` styled as a button). */
export function buttonClass(variant: ButtonVariant = 'outline', size: ButtonSize = 'md'): string {
  // The text button keeps `button-sm` type and 8px 16px padding at every size (§25.3).
  const sizing =
    variant === 'text'
      ? cx(size === 'md' ? 'min-h-control' : 'min-h-control-sm', 'px-4 py-2 text-button-sm')
      : buttonSize[size];
  return cx(buttonBase, sizing, buttonTone[variant]);
}

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function Card({
  as: As = 'section',
  className,
  children,
  ...rest
}: {
  as?: 'section' | 'article' | 'div';
  className?: string;
  children: ReactNode;
  'aria-labelledby'?: string;
  'aria-label'?: string;
}) {
  return (
    <As data-card className={cx(cardClass, 'p-6', className)} {...rest}>
      {children}
    </As>
  );
}

/** Uppercase, letter-spaced label above a page title (§25.3): no background, tone colour only. */
export function Eyebrow({ tone = 'teal', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span data-eyebrow className={cx('self-start text-eyebrow uppercase', toneText[tone])}>
      {children}
    </span>
  );
}

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      data-chip
      className={cx(
        'inline-flex items-center rounded-pill px-3 py-1 text-caption font-semibold whitespace-nowrap',
        toneText[tone],
        toneTint[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Tinted callout that starts with a bold label ("An toàn dữ liệu:", "Lưu ý:"). */
export function Callout({
  tone,
  label,
  icon,
  children,
  role,
  size = 'body',
  className,
}: {
  tone: Tone;
  label: string;
  icon?: ReactNode;
  children?: ReactNode;
  role?: 'status' | 'alert';
  /** `caption` for secondary notes (e.g. the data-safety line under a form). */
  size?: 'body' | 'caption';
  className?: string;
}) {
  return (
    <div
      role={role}
      className={cx(
        'flex items-start gap-2.5 rounded-card px-4 py-3 text-ink-soft',
        size === 'body' ? 'text-body' : 'text-caption',
        toneTint[tone],
        className,
      )}
    >
      {icon}
      <p className="m-0">
        <b className={toneText[tone]}>{label}</b> {children}
      </p>
    </div>
  );
}

/**
 * One-line text cut with "…" (MEMORY 2026-11-03 10:49: titles holding a user-given name). The DOM
 * keeps the full text, so screen readers read all of it; when the text is actually cut, the
 * element becomes focusable and a tooltip with the full text shows on hover and focus.
 *
 * Stacked Vietnamese marks (Ổ, Ẫ) and dots below (Ợ) reach outside a line box whose height equals
 * the font size; the 20px padding (cancelled by a negative margin, so layout is unchanged) keeps
 * them inside the clipping box.
 */
export function OneLine({
  as: As = 'span',
  text,
  className,
  wrapperClassName,
}: {
  as?: 'span' | 'h1';
  text: string;
  className?: string;
  wrapperClassName?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCut(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <Tooltip
      text={cut ? text : null}
      as={As === 'h1' ? 'div' : 'span'}
      className={cx('block min-w-0', wrapperClassName)}
    >
      <As
        ref={ref as never}
        data-one-line
        data-cut={cut || undefined}
        tabIndex={cut ? 0 : undefined}
        className={cx('-my-5 block truncate py-5', className)}
      >
        {text}
      </As>
    </Tooltip>
  );
}

export function PageHeader({
  eyebrow,
  eyebrowTone,
  title,
  oneLineTitle = false,
  subtitle,
  actions,
}: {
  eyebrow: ReactNode;
  eyebrowTone?: Tone;
  title: ReactNode;
  /**
   * The title holds a name chosen by a person (flow, version): keep it on one line, cut with "…"
   * and show the full name on hover/focus (AC-UI-50). Needs a string `title`.
   */
  oneLineTitle?: boolean;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-full min-w-0 flex-col gap-3">
        <Eyebrow {...(eyebrowTone ? { tone: eyebrowTone } : {})}>{eyebrow}</Eyebrow>
        {oneLineTitle && typeof title === 'string' ? (
          <OneLine as="h1" text={title} className="text-display-lg text-ink" />
        ) : (
          <h1 className="m-0 text-display-lg text-ink">{title}</h1>
        )}
        {subtitle && <p className="m-0 text-body-lg text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

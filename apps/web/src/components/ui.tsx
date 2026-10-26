import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Small set of primitives implementing spec §25.3 on top of the theme tokens in index.css. */

export type Tone = 'teal' | 'coral' | 'amber' | 'blue' | 'neutral';

export const toneText: Record<Tone, string> = {
  teal: 'text-teal-strong',
  coral: 'text-coral-text',
  amber: 'text-amber-text',
  blue: 'text-blue-text',
  neutral: 'text-body',
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

const buttonBase =
  'inline-flex min-h-target items-center justify-center gap-2 rounded-control px-5 text-label ' +
  // Colors animate only for hover/press. A disabled→enabled change must snap: a fade would leave
  // white text on a pale mid-transition teal (contrast below WCAG AA) for a moment.
  'transition-none hover:transition-colors active:transition-colors disabled:cursor-not-allowed';

export const buttonClass = {
  // White text only on #0F766E (WCAG AA).
  primary: cx(
    buttonBase,
    'bg-teal-strong font-bold text-white hover:bg-teal-hover',
    'disabled:bg-line disabled:text-muted',
  ),
  secondary: cx(
    buttonBase,
    'border border-line-input bg-card font-semibold text-ink hover:bg-page',
    'disabled:text-muted',
  ),
};

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonClass }) {
  return <button type={type} className={cx(buttonClass[variant], className)} {...props} />;
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
    <As className={cx('rounded-card bg-card p-6 shadow-card', className)} {...rest}>
      {children}
    </As>
  );
}

export function Eyebrow({ tone = 'teal', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'self-start rounded-full px-3.5 py-1.5 text-eyebrow uppercase',
        toneText[tone],
        toneTint[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-bold',
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
  className,
}: {
  tone: Tone;
  label: string;
  icon?: ReactNode;
  children?: ReactNode;
  role?: 'status' | 'alert';
  className?: string;
}) {
  return (
    <div
      role={role}
      className={cx(
        'flex items-start gap-2.5 rounded-callout px-4 py-3 text-label text-body',
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

export function PageHeader({
  eyebrow,
  eyebrowTone,
  title,
  subtitle,
  actions,
}: {
  eyebrow: ReactNode;
  eyebrowTone?: Tone;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2.5">
        <Eyebrow {...(eyebrowTone ? { tone: eyebrowTone } : {})}>{eyebrow}</Eyebrow>
        <h1 className="m-0 text-page-title text-ink">{title}</h1>
        {subtitle && <p className="m-0 text-copy text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

// ---- icons (inline SVG: no icon font, nothing fetched) ---------------------------------------

const iconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={className} {...iconProps}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={className} {...iconProps}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className} {...iconProps}>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className} {...iconProps}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={className} {...iconProps}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

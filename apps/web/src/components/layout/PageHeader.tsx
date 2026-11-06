import type { ReactNode } from 'react';
import { cx, Eyebrow, OneLine, type Tone } from '../ui';

export type PageHeaderVariant = 'workspace' | 'showcase';

const TITLE: Record<PageHeaderVariant, string> = {
  workspace: 'text-page-title',
  showcase: 'text-page-title-showcase',
};

/**
 * Page header (spec §25.5, AC-UI-63): eyebrow + `h1` + one subtitle line in `body` #475569, with
 * optional status chips (`meta`) beside the title and actions on the same row (bottom-aligned,
 * wrapping below when narrow). `workspace` = 28px title (Admin, forms), `showcase` = 32px (Result,
 * flow list, sign-in). `back` (a link back, e.g. "Danh sách flow") takes the eyebrow's place.
 * At 1280px a workspace header (eyebrow + title + subtitle) stays within 96px (AC-UI-62).
 */
export function PageHeader({
  variant = 'workspace',
  eyebrow,
  eyebrowTone,
  back,
  title,
  oneLineTitle = false,
  subtitle,
  meta,
  actions,
}: {
  variant?: PageHeaderVariant;
  /** Required unless `back` is given. */
  eyebrow?: ReactNode;
  eyebrowTone?: Tone;
  back?: ReactNode;
  title: ReactNode;
  /**
   * The title holds a name chosen by a person (flow, version): one line, cut with "…", full name
   * on hover/focus (AC-UI-50). Needs a string `title`.
   */
  oneLineTitle?: boolean;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const titleClass = cx('text-ink', TITLE[variant]);
  return (
    <div data-page-header={variant} className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-full min-w-0 flex-col gap-2">
        {back ??
          (eyebrow !== undefined && (
            <Eyebrow {...(eyebrowTone ? { tone: eyebrowTone } : {})}>{eyebrow}</Eyebrow>
          ))}
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {oneLineTitle && typeof title === 'string' ? (
            <OneLine as="h1" text={title} className={titleClass} wrapperClassName="max-w-full" />
          ) : (
            <h1 className={cx('m-0', titleClass)}>{title}</h1>
          )}
          {meta && <div className="flex shrink-0 items-center gap-2">{meta}</div>}
        </div>
        {subtitle && <p className="m-0 text-body text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

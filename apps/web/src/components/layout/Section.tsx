import { useId, type ReactNode } from 'react';
import { InfoTip } from '../InfoTip';
import { cardClass, cx } from '../ui';

/**
 * A titled block of a page (spec §25.5): a card (or no card with `plain`) with a `title-sm`
 * 20px/600 heading, an optional description behind an (i) button beside the heading (`InfoTip`,
 * MEMORY 2026-11-06 14:45: no explanation paragraph shown by default), actions on the right and
 * the content, `stack` (16px) apart. The `<section>` is named by its heading.
 */
export function Section({
  title,
  description,
  actions,
  plain = false,
  headingLevel = 2,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** No card frame (block placed straight on the page background). */
  plain?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section
      aria-labelledby={titleId}
      data-card={plain ? undefined : true}
      className={cx('flex min-w-0 flex-col gap-stack', !plain && cx(cardClass, 'p-6'), className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center">
          <Heading id={titleId} className="m-0 text-title-sm font-semibold text-ink">
            {title}
          </Heading>
          {description && (
            <InfoTip label={typeof title === 'string' ? title : ''}>{description}</InfoTip>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

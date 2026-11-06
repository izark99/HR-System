import { useId, type ReactNode } from 'react';
import { formatInteger } from '../lib/format';
import { cardClass, cx, toneText, type Tone } from './ui';

const BAR: Record<Tone, string> = {
  teal: 'border-t-teal',
  coral: 'border-t-coral',
  amber: 'border-t-amber',
  blue: 'border-t-blue',
  neutral: 'border-t-line-input',
};

/**
 * Row of KPI cards (spec §25.5): a description list, 4 per row on desktop, 2 on mobile. `label`
 * names the list for screen readers ("Số liệu đối chiếu").
 */
export function KpiRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl aria-label={label} className="m-0 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {children}
    </dl>
  );
}

/**
 * KPI card (spec §25.3 "KPI card"): card + 4px top bar by meaning (teal good, coral mismatch, amber
 * to check), the number in `kpi` (40px; 32px mobile) in Vietnamese format. Goes inside `KpiRow`.
 */
export function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone: Tone;
  hint?: ReactNode;
}) {
  const hintId = useId();
  return (
    <div
      data-card
      data-testid="kpi"
      className={cx(cardClass, 'flex min-w-0 flex-col gap-2 border-t-4 p-6', BAR[tone])}
    >
      <dt className="text-body font-semibold text-ink-soft">{label}</dt>
      <dd
        className={cx('m-0 text-kpi', toneText[tone])}
        aria-describedby={hint ? hintId : undefined}
      >
        {typeof value === 'number' ? formatInteger(value) : value}
      </dd>
      {hint && (
        <dd id={hintId} className="m-0 text-caption text-muted">
          {hint}
        </dd>
      )}
    </div>
  );
}

/**
 * The one dark card of a screen (spec §25.3 "Card tối"): the main conclusion, white text on
 * #1F2A44. At most one per screen.
 */
export function ConclusionCard({
  title,
  text,
  headingLevel = 2,
  children,
}: {
  title: string;
  text?: ReactNode;
  headingLevel?: 2 | 3;
  children?: ReactNode;
}) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section
      aria-labelledby={titleId}
      data-testid="conclusion"
      className="flex flex-col gap-2 rounded-card bg-ink p-6 text-white"
    >
      <Heading id={titleId} className="m-0 text-title-md text-white">
        {title}
      </Heading>
      {text && <p className="m-0 text-body text-white">{text}</p>}
      {children}
    </section>
  );
}

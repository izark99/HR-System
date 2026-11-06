import { useTranslation } from 'react-i18next';
import { cx } from '../../../components/ui';
import { CheckIcon } from '../../../components/icons';

const STEPS = ['params', 'upload', 'run', 'result'] as const;

/** Wizard progress (spec §15.1). `current` is 0-based. */
export function Steps({ current }: { current: number }) {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={t('run.stepsLabel')}
      className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 md:grid-cols-4"
    >
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className={cx(
              'flex items-center gap-3 rounded-card border bg-card p-4 text-body',
              active
                ? 'border-teal-strong font-semibold text-ink ring-1 ring-teal-strong'
                : 'border-line',
              done && 'font-semibold text-teal-strong',
              !done && !active && 'text-muted',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                done && 'bg-teal-strong text-white',
                active && 'bg-teal-strong text-white',
                !done && !active && 'bg-neutral text-muted',
              )}
            >
              {done ? <CheckIcon /> : i + 1}
            </span>
            {t(`run.step.${step}`)}
            {done && <span className="sr-only">({t('run.step.done')})</span>}
          </li>
        );
      })}
    </ol>
  );
}

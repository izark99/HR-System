import { useTranslation } from 'react-i18next';
import { CheckIcon, cx } from '../../../components/ui';

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
              'flex items-center gap-2.5 rounded-tile bg-card p-3.5 text-label',
              active ? 'font-bold text-ink ring-2 ring-teal-strong' : 'shadow-soft',
              done && 'font-semibold text-teal-strong',
              !done && !active && 'text-muted',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-small font-extrabold',
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

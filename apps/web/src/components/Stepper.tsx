import { useTranslation } from 'react-i18next';
import { CheckIcon } from './icons';
import { cx } from './ui';

export type StepState = 'done' | 'current' | 'todo';

/** State of step `index` when `current` is the 0-based current step. */
export function stepState(index: number, current: number): StepState {
  return index < current ? 'done' : index === current ? 'current' : 'todo';
}

const DOT: Record<StepState, string> = {
  done: 'bg-teal-tint text-teal-strong',
  current: 'bg-teal-strong text-white',
  todo: 'bg-neutral text-muted',
};

/**
 * Wizard progress on one line (spec §25.5 "Stepper", AC-UI-69): 28px dot (done: teal tint + check;
 * current: #0F766E with white number; not yet: #F1F5F9) + `caption` label, joined by a thin rule.
 * The current step has `aria-current="step"`; done steps say so to screen readers. Below 768px only
 * the current step's label is visible (the others stay readable by screen readers).
 */
export function Stepper({
  label,
  steps,
  current,
  className,
}: {
  /** Accessible name of the list ("Các bước"). */
  label: string;
  steps: { id: string; label: string }[];
  /** 0-based index of the current step. */
  current: number;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={label}
      data-stepper
      className={cx('m-0 flex list-none items-center gap-2 p-0', className)}
    >
      {steps.map((step, i) => {
        const state = stepState(i, current);
        return (
          <li
            key={step.id}
            aria-current={state === 'current' ? 'step' : undefined}
            data-step={state}
            className={cx('flex items-center gap-2', i > 0 ? 'min-w-0 flex-1' : 'shrink-0')}
          >
            {/* The rule joining this step to the previous one (decorative). */}
            {i > 0 && <span aria-hidden className="h-px min-w-4 flex-1 bg-line" />}
            <span
              aria-hidden
              className={cx(
                'flex size-7 shrink-0 items-center justify-center rounded-pill text-caption font-semibold',
                DOT[state],
              )}
            >
              {state === 'done' ? <CheckIcon /> : i + 1}
            </span>
            <span
              className={cx(
                'text-caption whitespace-nowrap',
                state === 'current' ? 'font-semibold text-ink' : 'text-muted',
                state !== 'current' && 'max-md:sr-only',
              )}
            >
              {step.label}
              {state === 'done' && <span className="sr-only"> ({t('common.stepDone')})</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

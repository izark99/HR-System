import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { checkboxClass, cx, denseInputClass, inputClass, labelClass, textareaClass } from './ui';

/** ARIA wiring for a native `<input>` / `<textarea>` / checkbox: spread it on the element. */
export interface NativeFieldProps {
  id: string;
  'aria-describedby': string | undefined;
  /** `true` with an error, else `undefined` (no attribute). */
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

/** What a `FormField` hands to its control. */
export interface FieldControlProps {
  /** id of the control: target of the `<label htmlFor>`. */
  id: string;
  /** id of the label, for controls named by `aria-labelledby` (MonthPicker, DatePicker). */
  labelId: string;
  /** Hint and error ids, `undefined` when there are none. */
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  /** For native controls (`<TextInput {...field.input} />`). */
  input: NativeFieldProps;
}

/**
 * The ids and ARIA wiring of a field (AC-UI-66), separate from the markup so it can be checked
 * alone: the hint comes before the error in `aria-describedby`, `aria-invalid` only with an error.
 */
export function fieldIds(
  base: string,
  { hint, error }: { hint: boolean; error: boolean },
): {
  control: string;
  label: string;
  hint: string;
  error: string;
  describedBy: string | undefined;
} {
  const ids = {
    control: `${base}-control`,
    label: `${base}-label`,
    hint: `${base}-hint`,
    error: `${base}-error`,
  };
  const describedBy = [hint ? ids.hint : '', error ? ids.error : ''].filter(Boolean).join(' ');
  return { ...ids, describedBy: describedBy || undefined };
}

/**
 * Labelled form field (spec §25.5 "FormField", AC-UI-66): `label` (16px/600) + control + hint
 * (`caption` #475569) + error (`caption` #C2410C). The control is rendered by `children` from the
 * wiring it receives, so the same field works for TextInput / Textarea / checkbox (spread
 * `field.input`), Select (`id`, `describedBy`, `invalid`, `required`) and MonthPicker / DatePicker
 * (`id`, `labelId`, `describedBy`, `invalid`). `inline`: checkbox first, label beside it.
 *
 * `dense`: 14px variant for the Designer side form (control 44px like the regular one, MEMORY
 * 2026-11-06 13:05).
 *
 * Two parts: the label, then the control with its hint and error. Inside a `FieldGrid` the field
 * becomes a two-row subgrid, so every control of a grid row starts on the same line however long
 * the labels above or the hints below are (AC-UI-78 rule 6).
 */
export function FormField({
  label,
  hint,
  error,
  required = false,
  dense = false,
  inline = false,
  id,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Message shown under the control; any non-empty value marks the field invalid. */
  error?: ReactNode;
  required?: boolean;
  dense?: boolean;
  /** Checkbox / switch: control and label on one row. */
  inline?: boolean;
  /** Fixed control id (default: generated). */
  id?: string;
  className?: string;
  children: (field: FieldControlProps) => ReactNode;
}) {
  const { t } = useTranslation();
  const generated = useId();
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const ids = fieldIds(id ?? generated, { hint: !!hint, error: hasError });
  const controlId = id ?? ids.control;
  const field: FieldControlProps = {
    id: controlId,
    labelId: ids.label,
    describedBy: ids.describedBy,
    invalid: hasError,
    required,
    input: {
      id: controlId,
      'aria-describedby': ids.describedBy,
      'aria-invalid': hasError || undefined,
      'aria-required': required || undefined,
    },
  };
  const labelEl = (
    <label
      id={ids.label}
      htmlFor={controlId}
      className={dense ? 'text-dense font-semibold text-ink' : labelClass}
    >
      {label}
      {required && <span className="sr-only"> ({t('common.required')})</span>}
    </label>
  );
  const text = dense ? 'text-dense' : 'text-caption';
  const gap = dense ? 'gap-1' : 'gap-2';
  return (
    <div
      data-form-field={dense ? 'dense' : 'default'}
      className={cx('flex min-w-0 flex-col', gap, className)}
    >
      {!inline && labelEl}
      <div className={cx('flex min-w-0 flex-col', gap)}>
        {inline ? (
          <div className="flex min-h-target items-center gap-2">
            {children(field)}
            {labelEl}
          </div>
        ) : (
          children(field)
        )}
        {hint && (
          <p id={ids.hint} className={cx('m-0 text-muted', text)}>
            {hint}
          </p>
        )}
        {hasError && (
          <p id={ids.error} className={cx('m-0 text-coral-text', text)}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Fields side by side in equal columns (spec §25.5 "FormField"): each `FormField` child spans two
 * shared rows (label / control + hint + error, CSS subgrid in `index.css`), so the controls of a
 * row line up even when one label wraps or one field has a hint (AC-UI-78 rule 6). A child that
 * only wraps a field (e.g. for an `onFocus` handler) must use `className="contents"`.
 *
 * Rows of fields are `stack` apart (`dense`: `stack-dense`), like the fields of the form around
 * it (AC-UI-78 rule 11). `hint`: one note for the whole row, under it, part of the same block.
 */
export function FieldGrid({
  cols = 2,
  dense = false,
  hint,
  className,
  children,
}: {
  cols?: 2 | 3;
  dense?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const grid = (
    <div
      data-field-grid
      className={cx(
        'hr-field-grid grid gap-x-2',
        dense ? 'gap-y-stack-dense' : 'gap-y-stack',
        cols === 3 ? 'grid-cols-3' : 'grid-cols-2',
        !hint && className,
      )}
    >
      {children}
    </div>
  );
  if (!hint) return grid;
  return (
    <div
      data-field-block
      className={cx('flex min-w-0 flex-col', dense ? 'gap-1' : 'gap-2', className)}
    >
      {grid}
      <p className={cx('m-0 text-muted', dense ? 'text-dense' : 'text-caption')}>{hint}</p>
    </div>
  );
}

/**
 * Checkbox (or radio) with its label on one row (spec §25.5): the 20px box never shrinks and sits
 * on the first line of the label. The row itself is only as tall as the label, so it stacks with
 * the same gap as other fields (AC-UI-78 rule 11); the clickable area reaches 12px above and below
 * (44px touch target for one dense line).
 */
export function Checkbox({
  label,
  dense = false,
  type = 'checkbox',
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
  dense?: boolean;
  type?: 'checkbox' | 'radio';
}) {
  return (
    <label
      data-checkbox
      className={cx(
        'relative flex cursor-pointer items-start gap-3 text-ink-soft',
        "before:absolute before:inset-x-0 before:-inset-y-3 before:content-['']",
        dense ? 'text-dense' : 'text-body',
        className,
      )}
    >
      {/* Positioned so it paints above the label's enlarged click area (::before). */}
      <span className={cx('relative flex shrink-0 items-center', dense ? 'h-5' : 'h-6')}>
        <input type={type} className={checkboxClass} {...input} />
      </span>
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** Text input on the §25.3 frame (44px; `dense` 14px). Spread a `FormField`'s props. */
export function TextInput({
  dense = false,
  className,
  type = 'text',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { dense?: boolean }) {
  return (
    <input type={type} className={cx(dense ? denseInputClass : inputClass, className)} {...props} />
  );
}

/** Multi-line input on the same frame. */
export function Textarea({
  className,
  rows = 3,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cx(textareaClass, className)} {...props} />;
}

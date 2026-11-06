import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cx, denseInputClass, inputClass, labelClass, textareaClass } from './ui';

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
 * `dense`: 14px variant (42px control) for the Designer side form.
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
  return (
    <div
      data-form-field={dense ? 'dense' : 'default'}
      className={cx('flex min-w-0 flex-col', dense ? 'gap-1' : 'gap-2', className)}
    >
      {inline ? (
        <div className="flex min-h-target items-center gap-2">
          {children(field)}
          {labelEl}
        </div>
      ) : (
        <>
          {labelEl}
          {children(field)}
        </>
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
  );
}

/** Text input on the §25.3 frame (44px; `dense` 42px / 14px). Spread a `FormField`'s props. */
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

import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, type SelectOption } from '../../../components/Select';
import { CloseIcon, cx } from '../../../components/ui';
import type { ColumnInfo } from '../../../engine/protocol';
import type { DesignIssue } from '../../../engine/design';

/** Form building blocks of the Designer panels (spec §25.3: inputs 42-46px, radius 12px). */

export const inputClass =
  'h-10.5 w-full min-w-0 rounded-control border bg-card px-3 text-label text-ink disabled:bg-neutral disabled:text-muted';
export const labelClass = 'text-small font-semibold text-body';

/** Issues whose path is `path` or below it. */
export function issuesAt(issues: readonly DesignIssue[], path: string): DesignIssue[] {
  return issues.filter(
    (i) => i.path !== undefined && (i.path === path || i.path.startsWith(`${path}.`)),
  );
}

export function FieldErrors({ id, issues }: { id: string; issues: readonly DesignIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul id={id} className="m-0 flex list-none flex-col gap-0.5 p-0 text-small text-coral-text">
      {issues.map((i, k) => (
        <li key={k}>{i.text}</li>
      ))}
    </ul>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  issues = [],
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  issues?: readonly DesignIssue[];
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode;
  className?: string;
}) {
  const errId = useId();
  const hintId = useId();
  const invalid = issues.length > 0;
  const describedBy = [invalid ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ');
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      {children(describedBy || undefined, invalid)}
      {hint && (
        <p id={hintId} className="m-0 text-small text-muted">
          {hint}
        </p>
      )}
      <FieldErrors id={errId} issues={issues} />
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  issues,
  hint,
  disabled,
  placeholder,
  mono,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  issues?: readonly DesignIssue[];
  hint?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint} issues={issues} className={className}>
      {(describedBy, invalid) => (
        <input
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className={cx(
            inputClass,
            mono && 'font-mono',
            invalid ? 'border-2 border-coral' : 'border-line-input',
          )}
        />
      )}
    </Field>
  );
}

/** Integer input; empty → undefined (optional fields). */
export function NumberField({
  label,
  value,
  onChange,
  issues,
  hint,
  disabled,
  min,
  max,
  className,
}: {
  label: ReactNode;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  issues?: readonly DesignIssue[];
  hint?: ReactNode;
  disabled?: boolean;
  min?: number;
  max?: number;
  className?: string;
}) {
  const id = useId();
  // Local text so that "" and partial input do not jump around while typing.
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value === undefined ? '' : String(value));
  }
  return (
    <Field label={label} htmlFor={id} hint={hint} issues={issues} className={className}>
      {(describedBy, invalid) => (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            setText(e.target.value);
            const n = e.target.value.trim() === '' ? undefined : Number(e.target.value);
            if (n === undefined || Number.isFinite(n)) {
              setShown(n);
              onChange(n);
            }
          }}
          className={cx(inputClass, invalid ? 'border-2 border-coral' : 'border-line-input')}
        />
      )}
    </Field>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
  disabled,
  issues = [],
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
  issues?: readonly DesignIssue[];
}) {
  const id = useId();
  const hintId = useId();
  const errId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex min-h-target cursor-pointer items-center gap-2.5 text-label text-body"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={
            [hint ? hintId : '', issues.length ? errId : ''].join(' ').trim() || undefined
          }
          aria-invalid={issues.length > 0 || undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="size-5 accent-teal-strong"
        />
        {label}
      </label>
      {hint && (
        <p id={hintId} className="m-0 text-small text-muted">
          {hint}
        </p>
      )}
      <FieldErrors id={errId} issues={issues} />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  issues,
  hint,
  disabled,
  placeholder,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  issues?: readonly DesignIssue[];
  hint?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint} issues={issues} className={className}>
      {(_describedBy, invalid) => (
        <Select
          id={id}
          value={value}
          onChange={onChange}
          options={options}
          disabled={disabled}
          invalid={invalid}
          {...(placeholder ? { placeholder } : {})}
          className="w-full"
        />
      )}
    </Field>
  );
}

/** One value per line (aliases, texts to skip, date formats, IN lists). */
export function LinesField({
  label,
  value,
  onChange,
  issues,
  hint,
  disabled,
  rows = 3,
}: {
  label: ReactNode;
  value: readonly string[];
  onChange: (v: string[]) => void;
  issues?: readonly DesignIssue[];
  hint?: ReactNode;
  disabled?: boolean;
  rows?: number;
}) {
  const id = useId();
  const [text, setText] = useState(value.join('\n'));
  const [shown, setShown] = useState(value);
  if (
    value !== shown &&
    value.join('\n') !==
      text
        .split('\n')
        .filter((l) => l.trim())
        .join('\n')
  ) {
    setShown(value);
    setText(value.join('\n'));
  }
  return (
    <Field label={label} htmlFor={id} hint={hint} issues={issues}>
      {(describedBy, invalid) => (
        <textarea
          id={id}
          rows={rows}
          value={text}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            setText(e.target.value);
            const lines = e.target.value
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l !== '');
            setShown(lines);
            onChange(lines);
          }}
          className={cx(
            'w-full rounded-control border bg-card px-3 py-2 text-label text-ink disabled:bg-neutral',
            invalid ? 'border-2 border-coral' : 'border-line-input',
          )}
        />
      )}
    </Field>
  );
}

export function columnOptions(columns: readonly ColumnInfo[] | null | undefined): SelectOption[] {
  return (columns ?? []).map((c) => ({
    value: c.key,
    label: c.title && c.title !== c.key ? `${c.title} (${c.key})` : c.key,
  }));
}

/** Options for a column field; the current value is kept even when unknown upstream. */
function withCurrent(options: SelectOption[], current: readonly string[]): SelectOption[] {
  const extra = current
    .filter((v) => v && !options.some((o) => o.value === v))
    .map((v) => ({ value: v, label: v }));
  return [...options, ...extra];
}

export function ColumnField({
  label,
  value,
  onChange,
  columns,
  issues,
  hint,
  disabled,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  columns: readonly ColumnInfo[] | null | undefined;
  issues?: readonly DesignIssue[];
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('designer');
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={withCurrent(columnOptions(columns), [value])}
      issues={issues}
      hint={columns ? hint : t('form.columnsUnknown')}
      disabled={disabled}
      placeholder={t('form.pickColumn')}
      {...(className ? { className } : {})}
    />
  );
}

/** Ordered list of columns: chosen ones with remove buttons, plus a dropdown to add one. */
export function ColumnListField({
  label,
  value,
  onChange,
  columns,
  issuesFor,
  issues = [],
  hint,
  disabled,
}: {
  label: ReactNode;
  value: readonly string[];
  onChange: (v: string[]) => void;
  columns: readonly ColumnInfo[] | null | undefined;
  /** Issues of the i-th entry (e.g. path `keys.0`). */
  issuesFor?: (i: number) => readonly DesignIssue[];
  issues?: readonly DesignIssue[];
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const { t } = useTranslation('designer');
  const addId = useId();
  const options = columnOptions(columns);
  const title = (key: string) => options.find((o) => o.value === key)?.label ?? key;
  const free = options.filter((o) => !value.includes(o.value));
  const listIssues = issues.filter((i) => !/\.\d+$/.test(i.path ?? ''));
  return (
    <Field label={label} hint={columns ? hint : t('form.columnsUnknown')} issues={listIssues}>
      {() => (
        <div className="flex flex-col gap-1.5">
          {value.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {value.map((key, i) => {
                const errs = issuesFor?.(i) ?? [];
                return (
                  <li key={`${key}-${i}`} className="flex flex-col gap-0.5">
                    <span
                      className={cx(
                        'flex min-h-target items-center justify-between gap-2 rounded-control border bg-card pl-3 text-label',
                        errs.length > 0 ? 'border-2 border-coral' : 'border-line',
                      )}
                    >
                      <span className="min-w-0 truncate">{title(key)}</span>
                      {!disabled && (
                        <button
                          type="button"
                          aria-label={t('form.removeItem', { item: title(key) })}
                          onClick={() => onChange(value.filter((_, k) => k !== i))}
                          className="inline-flex size-target shrink-0 items-center justify-center rounded-control hover:bg-page"
                        >
                          <CloseIcon />
                        </button>
                      )}
                    </span>
                    {errs.map((e, k) => (
                      <span key={k} className="text-small text-coral-text">
                        {e.text}
                      </span>
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
          {!disabled && (
            <>
              <label htmlFor={addId} className="sr-only">
                {t('form.addColumnTo', { field: typeof label === 'string' ? label : '' })}
              </label>
              <Select
                id={addId}
                value=""
                onChange={(v) => v && onChange([...value, v])}
                options={free}
                placeholder={t('form.addColumn')}
                disabled={free.length === 0}
                className="w-full"
              />
            </>
          )}
        </div>
      )}
    </Field>
  );
}

/** Repeating group (metrics, conditions, sheets…) with add / remove / move. */
export function ListEditor<T>({
  label,
  items,
  onChange,
  render,
  create,
  addLabel,
  itemLabel,
  disabled,
  issues = [],
}: {
  label: ReactNode;
  items: readonly T[];
  onChange: (items: T[]) => void;
  render: (item: T, i: number, set: (item: T) => void) => ReactNode;
  create: () => T;
  addLabel: string;
  itemLabel: (i: number) => string;
  disabled?: boolean;
  issues?: readonly DesignIssue[];
}) {
  const { t } = useTranslation('designer');
  const errId = useId();
  const listIssues = issues.filter((i) => !/\.\d+(\.|$)/.test(i.path ?? ''));
  const move = (from: number, to: number) => {
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    onChange(next);
  };
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className={cx(labelClass, 'mb-1.5 p-0')}>{label}</legend>
      <FieldErrors id={errId} issues={listIssues} />
      {items.map((item, i) => (
        <div
          key={i}
          role="group"
          aria-label={itemLabel(i)}
          className="flex flex-col gap-2 rounded-tile border border-line bg-page p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-small font-bold text-ink">{itemLabel(i)}</span>
            {!disabled && (
              <span className="flex gap-1">
                <button
                  type="button"
                  disabled={i === 0}
                  aria-label={t('form.moveUp', { item: itemLabel(i) })}
                  onClick={() => move(i, i - 1)}
                  className="inline-flex size-target items-center justify-center rounded-control text-label hover:bg-card disabled:text-line-input"
                >
                  {t('form.up')}
                </button>
                <button
                  type="button"
                  disabled={i === items.length - 1}
                  aria-label={t('form.moveDown', { item: itemLabel(i) })}
                  onClick={() => move(i, i + 1)}
                  className="inline-flex size-target items-center justify-center rounded-control text-label hover:bg-card disabled:text-line-input"
                >
                  {t('form.down')}
                </button>
                <button
                  type="button"
                  aria-label={t('form.removeItem', { item: itemLabel(i) })}
                  onClick={() => onChange(items.filter((_, k) => k !== i))}
                  className="inline-flex size-target items-center justify-center rounded-control hover:bg-card"
                >
                  <CloseIcon />
                </button>
              </span>
            )}
          </div>
          {render(item, i, (next) => onChange(items.map((x, k) => (k === i ? next : x))))}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={() => onChange([...items, create()])}
          className="min-h-target self-start rounded-control border border-dashed border-line-input bg-card px-3.5 text-small font-semibold text-teal-strong hover:bg-teal-tint-soft"
        >
          {addLabel}
        </button>
      )}
    </fieldset>
  );
}

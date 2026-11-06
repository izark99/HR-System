import type { FlowParam } from '@hrflow/flow-schema';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DatePicker } from '../../../components/DatePicker';
import { MonthPicker } from '../../../components/MonthPicker';
import { Select } from '../../../components/Select';
import { FormField, TextInput } from '../../../components/FormField';
import { Section } from '../../../components/layout';
import type { ParamValues } from '../../../engine/protocol';

const INPUT_TYPE: Partial<Record<FlowParam['type'], string>> = {
  number: 'number',
  string: 'text',
};

export function ParamsCard({
  params,
  values,
  disabled,
  onChange,
  aside,
}: {
  params: readonly FlowParam[];
  values: ParamValues;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
  /** Shown next to the params (e.g. the version effective for the chosen period). */
  aside?: ReactNode;
}) {
  const { t } = useTranslation();
  if (params.length === 0 && !aside) return null;
  return (
    <Section title={t('run.paramsTitle')}>
      <div className="flex flex-wrap items-end gap-6">
        {params.map((p) => {
          const value = String(values[p.key] ?? '');
          const options = Array.isArray(p.options) ? p.options : null;
          return (
            <FormField
              key={p.key}
              id={`param-${p.key}`}
              required={p.required}
              label={
                <>
                  {p.label}
                  {p.required && <span aria-hidden> *</span>}
                </>
              }
            >
              {(field) =>
                p.type === 'month' ? (
                  <MonthPicker
                    id={field.id}
                    labelId={field.labelId}
                    value={value}
                    required={p.required}
                    disabled={disabled}
                    onChange={(v) => onChange(p.key, v)}
                  />
                ) : p.type === 'date' ? (
                  <DatePicker
                    id={field.id}
                    labelId={field.labelId}
                    value={value}
                    required={p.required}
                    disabled={disabled}
                    onChange={(v) => onChange(p.key, v)}
                  />
                ) : p.type === 'select' && options ? (
                  <Select
                    id={field.id}
                    value={value}
                    required={p.required}
                    disabled={disabled}
                    onChange={(v) => onChange(p.key, v)}
                    options={[
                      { value: '', label: t('select.none') },
                      ...options.map((o) => ({ value: o.value, label: o.label })),
                    ]}
                  />
                ) : (
                  <TextInput
                    id={field.id}
                    type={INPUT_TYPE[p.type] ?? 'text'}
                    value={value}
                    required={p.required}
                    disabled={disabled}
                    onChange={(e) => onChange(p.key, e.target.value)}
                  />
                )
              }
            </FormField>
          );
        })}
        {aside}
      </div>
    </Section>
  );
}

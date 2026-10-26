import type { FlowParam } from '@hrflow/flow-schema';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DatePicker } from '../../../components/DatePicker';
import { MonthPicker } from '../../../components/MonthPicker';
import { Card } from '../../../components/ui';
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
    <Card aria-label={t('run.paramsTitle')} className="flex flex-wrap items-end gap-5">
      {params.map((p) => {
        const id = `param-${p.key}`;
        const labelId = `${id}-label`;
        const value = String(values[p.key] ?? '');
        const options = Array.isArray(p.options) ? p.options : null;
        return (
          <div key={p.key} className="flex flex-col gap-1.5">
            <label id={labelId} htmlFor={id} className="text-label font-semibold text-body">
              {p.label}
              {p.required && (
                <>
                  <span aria-hidden> *</span>
                  <span className="sr-only"> ({t('common.required')})</span>
                </>
              )}
            </label>
            {p.type === 'month' ? (
              <MonthPicker
                id={id}
                labelId={labelId}
                value={value}
                required={p.required}
                disabled={disabled}
                onChange={(v) => onChange(p.key, v)}
              />
            ) : p.type === 'date' ? (
              <DatePicker
                id={id}
                labelId={labelId}
                value={value}
                required={p.required}
                disabled={disabled}
                onChange={(v) => onChange(p.key, v)}
              />
            ) : p.type === 'select' && options ? (
              <select
                id={id}
                value={value}
                required={p.required}
                disabled={disabled}
                onChange={(e) => onChange(p.key, e.target.value)}
                className="h-target min-w-48 rounded-control border border-line-input bg-card px-3.5 text-label"
              >
                <option value="" />
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={INPUT_TYPE[p.type] ?? 'text'}
                value={value}
                required={p.required}
                disabled={disabled}
                onChange={(e) => onChange(p.key, e.target.value)}
                className="h-target rounded-control border border-line-input bg-card px-3.5 text-label"
              />
            )}
          </div>
        );
      })}
      {aside}
    </Card>
  );
}

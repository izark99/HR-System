import { FieldGrid } from '../../../components/FormField';
import { useTranslation } from 'react-i18next';
import type { DesignIssue } from '../../../engine/design';
import { paramUsages, type DesignerDoc, type JsonObject } from '../model';
import { resized } from './NodeForms';
import { CheckField, issuesAt, ListEditor, SelectField, TextField } from './fields';
import { KeyUsageWarning, useRenameWatch } from './SlotForm';
import { useRefCatalog } from '../ref-catalog';

/**
 * Flow params (spec §8, §15.3 "Tham số"): key, label, type, required, log (default by type,
 * explained), as-of date (one at most, month/date) and the options of `select`: typed in, or
 * taken from a reference table (`fromRefTable` + value / label columns, spec §34 AC-RT-10).
 */

type Obj = Record<string, unknown>;
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const TYPES = ['month', 'date', 'string', 'number', 'boolean', 'select'];

function without(o: Obj, ...keys: string[]): Obj {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
}

export function ParamsForm({
  doc,
  issues,
  readOnly: ro,
  onChange,
}: {
  doc: DesignerDoc;
  issues: readonly DesignIssue[];
  readOnly: boolean;
  onChange: (params: JsonObject[], mergeKey: string | undefined) => void;
}) {
  const { t } = useTranslation('designer');
  const watch = useRenameWatch();
  const catalog = useRefCatalog();
  const tables = catalog.tables ?? [];
  const params = doc.params;
  const forParam = (i: number) => issues.filter((x) => x.paramIndex === i);
  return (
    <div className="flex flex-col gap-stack-dense">
      <ListEditor
        label={t('params.title')}
        hint={t('params.intro')}
        items={params}
        onChange={(v) =>
          onChange(
            v,
            v.length !== params.length || v.some((x, i) => params[i] && resized(params[i], x))
              ? undefined
              : 'params',
          )
        }
        create={() => ({
          key: `tham_so_${params.length + 1}`,
          label: t('params.newLabel', { n: params.length + 1 }),
          type: 'string',
        })}
        addLabel={t('params.add')}
        itemLabel={(i) => str(params[i]?.label) || t('params.paramN', { n: i + 1 })}
        disabled={ro}
        render={(p, i, setItem) => {
          const set = (patch: Obj) => setItem({ ...p, ...patch });
          const at = (path: string) => issuesAt(forParam(i), path);
          const type = str(p.type, 'string');
          const options = Array.isArray(p.options)
            ? (p.options as Obj[]).filter((o) => typeof o === 'object' && o !== null)
            : [];
          const log = p.log === true ? 'yes' : p.log === false ? 'no' : 'default';
          const field = `param${i}`;
          const oldKey = watch.warningFor(field);
          const fromRef =
            typeof p.options === 'object' && p.options !== null && !Array.isArray(p.options)
              ? (p.options as Obj)
              : null;
          const refTable = fromRef
            ? tables.find((x) => x.code === str(fromRef.fromRefTable))
            : null;
          const tableOptions = tables.map((x) => ({
            value: x.code,
            label: `${x.code} — ${x.name}`,
          }));
          const columnOptions = (refTable?.columns ?? []).map((col) => ({
            value: col.key,
            label: col.key,
          }));
          const keep = (list: { value: string; label: string }[], v: string) =>
            v && !list.some((o) => o.value === v) ? [...list, { value: v, label: v }] : list;
          const setRef = (patch: Obj) => set({ options: { ...fromRef, ...patch } });
          const typeField = (
            <SelectField
              label={t('params.type')}
              value={type}
              onChange={(v) => {
                let next: Obj = { ...p, type: v };
                if (v !== 'select') next = without(next, 'options');
                else if (!Array.isArray(next.options)) next.options = [];
                if (v !== 'month' && v !== 'date') next = without(next, 'isAsOfDate');
                setItem(next);
              }}
              options={TYPES.map((x) => ({ value: x, label: t(`params.types.${x}`) }))}
              issues={at('type')}
              disabled={ro}
            />
          );
          return (
            <>
              <FieldGrid dense>
                <div className="contents" onFocus={() => watch.onFocus(field, str(p.key))}>
                  <TextField
                    label={t('params.key')}
                    value={str(p.key)}
                    mono
                    onChange={(v) => {
                      watch.onChange(field, v);
                      set({ key: v });
                    }}
                    issues={at('key')}
                    hint={t('params.keyHint')}
                    disabled={ro}
                  />
                </div>
                <TextField
                  label={t('params.label')}
                  value={str(p.label)}
                  onChange={(v) => set({ label: v })}
                  issues={at('label')}
                  disabled={ro}
                />
              </FieldGrid>
              {oldKey && <KeyUsageWarning oldKey={oldKey} nodes={paramUsages(doc, oldKey)} />}
              {type === 'select' ? (
                <FieldGrid dense>
                  {typeField}
                  <SelectField
                    label={t('params.optionSource')}
                    value={fromRef ? 'ref' : 'list'}
                    onChange={(v) =>
                      set({
                        options:
                          v === 'ref' ? { fromRefTable: '', valueColumn: '', labelColumn: '' } : [],
                      })
                    }
                    options={[
                      { value: 'list', label: t('params.sourceList') },
                      { value: 'ref', label: t('params.sourceRef') },
                    ]}
                    disabled={ro}
                  />
                </FieldGrid>
              ) : (
                typeField
              )}
              <CheckField
                label={t('params.required')}
                checked={p.required === true}
                onChange={(v) => set({ required: v })}
                disabled={ro}
              />
              <SelectField
                label={t('params.log')}
                value={log}
                onChange={(v) =>
                  setItem(v === 'default' ? without(p, 'log') : { ...p, log: v === 'yes' })
                }
                options={[
                  {
                    value: 'default',
                    label: t('params.logDefault', {
                      value: type === 'string' ? t('params.logNo') : t('params.logYes'),
                    }),
                  },
                  { value: 'yes', label: t('params.logYes') },
                  { value: 'no', label: t('params.logNo') },
                ]}
                hint={t('params.logHint')}
                disabled={ro}
              />
              {(type === 'month' || type === 'date') && (
                <CheckField
                  label={t('params.asOf')}
                  checked={p.isAsOfDate === true}
                  onChange={(v) =>
                    setItem(v ? { ...p, isAsOfDate: true } : without(p, 'isAsOfDate'))
                  }
                  hint={t('params.asOfHint')}
                  issues={at('isAsOfDate')}
                  disabled={ro}
                />
              )}
              {type === 'select' && fromRef && (
                <>
                  <SelectField
                    label={t('params.fromRefTable')}
                    value={str(fromRef.fromRefTable)}
                    onChange={(v) => setRef({ fromRefTable: v })}
                    options={keep(tableOptions, str(fromRef.fromRefTable))}
                    issues={at('options.fromRefTable')}
                    hint={t('params.refHint')}
                    disabled={ro}
                  />
                  <FieldGrid dense>
                    <SelectField
                      label={t('params.valueColumn')}
                      value={str(fromRef.valueColumn)}
                      onChange={(v) => setRef({ valueColumn: v })}
                      options={keep(columnOptions, str(fromRef.valueColumn))}
                      issues={at('options.valueColumn')}
                      disabled={ro}
                    />
                    <SelectField
                      label={t('params.labelColumn')}
                      value={str(fromRef.labelColumn)}
                      onChange={(v) => setRef({ labelColumn: v })}
                      options={keep(columnOptions, str(fromRef.labelColumn))}
                      issues={at('options.labelColumn')}
                      disabled={ro}
                    />
                  </FieldGrid>
                </>
              )}
              {type === 'select' && !fromRef && (
                <ListEditor
                  label={t('params.options')}
                  items={options}
                  onChange={(v) => set({ options: v })}
                  issues={at('options')}
                  create={() => ({ value: '', label: '' })}
                  addLabel={t('params.addOption')}
                  itemLabel={(k) => str(options[k]?.label) || t('params.optionN', { n: k + 1 })}
                  disabled={ro}
                  render={(o, k, setOption) => (
                    <FieldGrid dense>
                      <TextField
                        label={t('params.optionValue')}
                        value={str(o.value)}
                        onChange={(v) => setOption({ ...o, value: v })}
                        issues={at(`options.${k}`)}
                        disabled={ro}
                      />
                      <TextField
                        label={t('params.optionLabel')}
                        value={str(o.label)}
                        onChange={(v) => setOption({ ...o, label: v })}
                        disabled={ro}
                      />
                    </FieldGrid>
                  )}
                />
              )}
            </>
          );
        }}
      />
    </div>
  );
}

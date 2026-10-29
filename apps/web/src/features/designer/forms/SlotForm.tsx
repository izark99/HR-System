import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Callout } from '../../../components/ui';
import type { DesignIssue } from '../../../engine/design';
import type { DesignerDoc, DNode, JsonObject } from '../model';
import { columnUsages, slotUsages } from '../model';
import {
  CheckField,
  ColumnListField,
  issuesAt,
  LinesField,
  ListEditor,
  NumberField,
  SelectField,
  TextField,
} from './fields';

/**
 * Input slot form (spec §10, §15.3; MEMORY 2026-10-26 22:52): every field of `InputSlotSchema`,
 * the cross-field rules reported by the engine on the matching field.
 */

type Obj = Record<string, unknown>;
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const objs = (v: unknown): Obj[] =>
  Array.isArray(v)
    ? v.filter((x): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x))
    : [];
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const obj = (v: unknown): Obj | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : undefined;

const TYPES = ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime'];
const RULE_KINDS = ['unique', 'regex', 'min', 'max'] as const;

function without(o: Obj, ...keys: string[]): Obj {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
}

/** Warning shown after a key used elsewhere was changed (nodes are not updated). */
export function KeyUsageWarning({ oldKey, nodes }: { oldKey: string; nodes: DNode[] }) {
  const { t } = useTranslation('designer');
  if (nodes.length === 0) return null;
  return (
    <Callout tone="amber" label={t('form.noteLabel')} role="status">
      {t('form.keyUsed', {
        key: oldKey,
        nodes: nodes.map((n) => n.label ?? n.id).join(', '),
      })}
    </Callout>
  );
}

/** Tracks the value a key field had when focused, to warn about renames (AC-B3-37). */
export function useRenameWatch() {
  const [focusKey, setFocusKey] = useState<{ field: string; value: string } | null>(null);
  const [warning, setWarning] = useState<{ field: string; oldKey: string } | null>(null);
  return {
    onFocus: (field: string, value: string) => {
      setFocusKey({ field, value });
      setWarning(null);
    },
    onChange: (field: string, next: string) => {
      if (focusKey?.field === field && focusKey.value && next !== focusKey.value) {
        setWarning({ field, oldKey: focusKey.value });
      } else if (focusKey?.field === field) setWarning(null);
    },
    warningFor: (field: string) => (warning?.field === field ? warning.oldKey : null),
  };
}

function ColumnEditor({
  col,
  i,
  set,
  issues,
  ro,
  doc,
  slotKey,
  watch,
}: {
  col: Obj;
  i: number;
  set: (c: Obj) => void;
  issues: readonly DesignIssue[];
  ro: boolean;
  doc: DesignerDoc;
  slotKey: string;
  watch: ReturnType<typeof useRenameWatch>;
}) {
  const { t } = useTranslation('designer');
  const at = (path: string) => issuesAt(issues, `columns.${i}.${path}`);
  const type = str(col.type, 'string');
  const required = col.required === true;
  const rules = objs(col.rules);
  const field = `col${i}`;
  const oldKey = watch.warningFor(field);
  const ruleKind = (r: Obj) => RULE_KINDS.find((k) => k in r) ?? 'unique';
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div onFocus={() => watch.onFocus(field, str(col.key))}>
          <TextField
            label={t('slot.col.key')}
            value={str(col.key)}
            mono
            onChange={(v) => {
              watch.onChange(field, v);
              set({ ...col, key: v });
            }}
            issues={at('key')}
            disabled={ro}
          />
        </div>
        <TextField
          label={t('slot.col.label')}
          value={str(col.label)}
          onChange={(v) => set(v ? { ...col, label: v } : without(col, 'label'))}
          issues={at('label')}
          disabled={ro}
        />
      </div>
      {oldKey && <KeyUsageWarning oldKey={oldKey} nodes={columnUsages(doc, slotKey, oldKey)} />}
      <LinesField
        label={t('slot.col.aliases')}
        value={strs(col.aliases)}
        onChange={(v) => set({ ...col, aliases: v })}
        issues={at('aliases')}
        hint={t('slot.col.aliasesHint')}
        disabled={ro}
        rows={2}
      />
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label={t('slot.col.type')}
          value={type}
          onChange={(v) => {
            let next: Obj = { ...col, type: v };
            if (v !== 'date' && v !== 'datetime') next = without(next, 'dateFormats');
            set(next);
          }}
          options={TYPES.map((x) => ({ value: x, label: t(`types.${x}`) }))}
          issues={at('type')}
          disabled={ro}
        />
        <SelectField
          label={t('slot.col.presence')}
          value={str(col.presence, required ? 'required' : 'optional')}
          onChange={(v) => set({ ...col, presence: v })}
          options={[
            { value: 'required', label: t('slot.col.presenceRequired') },
            { value: 'optional', label: t('slot.col.presenceOptional') },
          ]}
          issues={at('presence')}
          hint={t('slot.col.presenceHint')}
          disabled={ro}
        />
      </div>
      <CheckField
        label={t('slot.col.required')}
        checked={required}
        onChange={(v) =>
          set(v ? without({ ...col, required: true }, 'defaultValue') : { ...col, required: false })
        }
        hint={t('slot.col.requiredHint')}
        disabled={ro}
      />
      {!required &&
        (type === 'boolean' ? (
          <SelectField
            label={t('slot.col.defaultValue')}
            value={col.defaultValue === true ? 'true' : col.defaultValue === false ? 'false' : ''}
            onChange={(v) =>
              set(v === '' ? without(col, 'defaultValue') : { ...col, defaultValue: v === 'true' })
            }
            options={[
              { value: '', label: t('slot.col.noDefault') },
              { value: 'true', label: t('form.yes') },
              { value: 'false', label: t('form.no') },
            ]}
            issues={at('defaultValue')}
            disabled={ro}
          />
        ) : (
          <TextField
            label={t('slot.col.defaultValue')}
            value={
              typeof col.defaultValue === 'string' || typeof col.defaultValue === 'number'
                ? String(col.defaultValue)
                : ''
            }
            onChange={(v) => {
              if (v === '') return set(without(col, 'defaultValue'));
              const numeric =
                (type === 'decimal' || type === 'integer') && /^-?\d+(\.\d+)?$/.test(v);
              set({ ...col, defaultValue: numeric ? Number(v) : v });
            }}
            issues={at('defaultValue')}
            hint={t(`slot.col.defaultHint.${type}`)}
            disabled={ro}
          />
        ))}
      {(type === 'date' || type === 'datetime') && (
        <LinesField
          label={t('slot.col.dateFormats')}
          value={strs(col.dateFormats)}
          onChange={(v) => set(v.length ? { ...col, dateFormats: v } : without(col, 'dateFormats'))}
          issues={at('dateFormats')}
          hint={t('slot.col.dateFormatsHint')}
          disabled={ro}
          rows={2}
        />
      )}
      {(type === 'decimal' || type === 'integer') && (
        <SelectField
          label={t('slot.col.decimalSeparator')}
          value={str(col.decimalSeparator, '.')}
          onChange={(v) => set({ ...col, decimalSeparator: v })}
          options={[
            { value: '.', label: t('slot.col.sepDot') },
            { value: ',', label: t('slot.col.sepComma') },
          ]}
          hint={t('slot.col.decimalSeparatorHint')}
          disabled={ro}
        />
      )}
      <ListEditor
        label={t('slot.col.rules')}
        items={rules}
        onChange={(v) => set(v.length ? { ...col, rules: v } : without(col, 'rules'))}
        issues={at('rules')}
        create={() => ({ unique: true })}
        addLabel={t('slot.col.addRule')}
        itemLabel={(k) => t(`slot.rule.${ruleKind(rules[k] ?? {})}`)}
        disabled={ro}
        render={(r, k, setRule) => {
          const kind = ruleKind(r);
          const sev = str(r.severity, 'error');
          const withSev = (x: Obj) => (sev !== 'error' ? { ...x, severity: sev } : x);
          return (
            <>
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label={t('slot.rule.kind')}
                  value={kind}
                  onChange={(v) =>
                    setRule(
                      withSev(
                        v === 'unique'
                          ? { unique: true }
                          : v === 'regex'
                            ? { regex: '' }
                            : { [v]: '0' },
                      ),
                    )
                  }
                  options={RULE_KINDS.map((x) => ({ value: x, label: t(`slot.rule.${x}`) }))}
                  disabled={ro}
                />
                <SelectField
                  label={t('slot.rule.severity')}
                  value={sev}
                  onChange={(v) =>
                    setRule(v === 'error' ? without(r, 'severity') : { ...r, severity: v })
                  }
                  options={[
                    { value: 'error', label: t('slot.rule.error') },
                    { value: 'warning', label: t('slot.rule.warning') },
                  ]}
                  disabled={ro}
                />
              </div>
              {kind === 'regex' && (
                <TextField
                  label={t('slot.rule.regexValue')}
                  value={str(r.regex)}
                  mono
                  onChange={(v) => setRule({ ...r, regex: v })}
                  issues={issuesAt(issues, `columns.${i}.rules.${k}`)}
                  hint={t('slot.rule.regexHint')}
                  disabled={ro}
                />
              )}
              {(kind === 'min' || kind === 'max') && (
                <TextField
                  label={t(`slot.rule.${kind}Value`)}
                  value={String((r[kind] as string | number | undefined) ?? '')}
                  onChange={(v) => setRule({ ...r, [kind]: v.trim().replace(',', '.') })}
                  issues={issuesAt(issues, `columns.${i}.rules.${k}`)}
                  disabled={ro}
                />
              )}
            </>
          );
        }}
      />
    </>
  );
}

export function SlotForm({
  slot,
  index,
  issues,
  doc,
  readOnly: ro,
  onChange,
}: {
  slot: JsonObject;
  index: number;
  issues: readonly DesignIssue[];
  doc: DesignerDoc;
  readOnly: boolean;
  onChange: (slot: JsonObject, field: string) => void;
}) {
  const { t } = useTranslation('designer');
  const watch = useRenameWatch();
  const at = (path: string) => issuesAt(issues, path);
  const set = (patch: Obj, field: string) =>
    onChange({ ...slot, ...patch }, `slot${index}:${field}`);
  const drop = (field: string, ...keys: string[]) =>
    onChange(without(slot, ...keys), `slot${index}:${field}`);
  const sheet = obj(slot.sheet) ?? { mode: 'byIndex', value: 0 };
  const mode = str(sheet.mode, 'byIndex');
  const accept = strs(slot.accept);
  const acceptList = accept.length > 0 || slot.accept !== undefined ? accept : ['.xlsx', '.xls'];
  const skip = obj(slot.skipRows);
  const multiple = obj(slot.multiple) ?? {};
  const columns = objs(slot.columns);
  const key = str(slot.key);
  const keyWarning = watch.warningFor('key');
  const colInfos = columns
    .map((c) => ({ key: str(c.key), title: str(c.label) || str(c.key), type: 'string' as const }))
    .filter((c) => c.key);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-2">
        <div onFocus={() => watch.onFocus('key', key)}>
          <TextField
            label={t('slot.key')}
            value={key}
            mono
            onChange={(v) => {
              watch.onChange('key', v);
              set({ key: v }, 'key');
            }}
            issues={at('key')}
            hint={t('slot.keyHint')}
            disabled={ro}
          />
        </div>
        <TextField
          label={t('slot.label')}
          value={str(slot.label)}
          onChange={(v) => set({ label: v }, 'label')}
          issues={at('label')}
          disabled={ro}
        />
      </div>
      {keyWarning && <KeyUsageWarning oldKey={keyWarning} nodes={slotUsages(doc, keyWarning)} />}
      <CheckField
        label={t('slot.required')}
        checked={slot.required !== false}
        onChange={(v) => set({ required: v }, 'required')}
        hint={t('slot.requiredHint')}
        disabled={ro}
      />
      <fieldset className="m-0 flex gap-4 border-0 p-0">
        <legend className="mb-1 p-0 text-small font-semibold text-body">{t('slot.accept')}</legend>
        {['.xlsx', '.xls'].map((ext) => (
          <CheckField
            key={ext}
            label={ext}
            checked={acceptList.includes(ext)}
            onChange={(v) =>
              set(
                {
                  accept: v
                    ? ['.xlsx', '.xls'].filter((x) => x === ext || acceptList.includes(x))
                    : acceptList.filter((x) => x !== ext),
                },
                'accept',
              )
            }
            issues={ext === '.xlsx' ? at('accept') : []}
            disabled={ro}
          />
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label={t('slot.sheetMode')}
          value={mode}
          onChange={(v) =>
            set(
              {
                sheet:
                  v === 'byName'
                    ? { mode: v, value: '' }
                    : v === 'byIndex'
                      ? { mode: v, value: 0 }
                      : { mode: v },
              },
              'sheet',
            )
          }
          options={['byIndex', 'byName', 'firstMatchingHeaders'].map((m) => ({
            value: m,
            label: t(`slot.sheetModes.${m}`),
          }))}
          issues={at('sheet.mode')}
          disabled={ro}
        />
        {mode === 'byName' && (
          <TextField
            label={t('slot.sheetName')}
            value={str(sheet.value)}
            onChange={(v) => set({ sheet: { mode, value: v } }, 'sheet.value')}
            issues={at('sheet')}
            disabled={ro}
          />
        )}
        {mode === 'byIndex' && (
          <NumberField
            label={t('slot.sheetIndex')}
            value={typeof sheet.value === 'number' ? sheet.value + 1 : 1}
            min={1}
            onChange={(v) =>
              set({ sheet: { mode, value: Math.max(0, (v ?? 1) - 1) } }, 'sheet.value')
            }
            issues={at('sheet')}
            hint={t('slot.sheetIndexHint')}
            disabled={ro}
          />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField
          label={t('slot.headerRow')}
          value={num(slot.headerRow) ?? 1}
          min={1}
          onChange={(v) => set({ headerRow: v ?? 1 }, 'headerRow')}
          issues={at('headerRow')}
          disabled={ro}
        />
        <NumberField
          label={t('slot.headerRows')}
          value={num(slot.headerRows) ?? 1}
          min={1}
          max={5}
          onChange={(v) => set({ headerRows: v ?? 1 }, 'headerRows')}
          issues={at('headerRows')}
          disabled={ro}
        />
        <NumberField
          label={t('slot.dataStartRow')}
          value={num(slot.dataStartRow)}
          min={1}
          onChange={(v) =>
            v === undefined
              ? drop('dataStartRow', 'dataStartRow')
              : set({ dataStartRow: v }, 'dataStartRow')
          }
          issues={at('dataStartRow')}
          disabled={ro}
        />
      </div>
      <p className="m-0 -mt-2 text-small text-muted">{t('slot.rowsHint')}</p>
      <NumberField
        label={t('slot.stopAt')}
        value={num(obj(slot.stopAt)?.blankRows)}
        min={1}
        onChange={(v) =>
          v === undefined ? drop('stopAt', 'stopAt') : set({ stopAt: { blankRows: v } }, 'stopAt')
        }
        issues={at('stopAt')}
        hint={t('slot.stopAtHint')}
        disabled={ro}
      />
      <CheckField
        label={t('slot.skipRows')}
        checked={skip !== undefined}
        onChange={(v) =>
          v
            ? set(
                {
                  skipRows: {
                    whenBlank: colInfos[0] ? [colInfos[0].key] : [],
                    whenKeyContains: [],
                  },
                },
                'skipRows',
              )
            : drop('skipRows', 'skipRows')
        }
        hint={t('slot.skipRowsHint')}
        disabled={ro}
      />
      {skip && (
        <>
          <ColumnListField
            label={t('slot.whenBlank')}
            value={strs(skip.whenBlank)}
            onChange={(v) => set({ skipRows: { ...skip, whenBlank: v } }, 'skipRows.whenBlank')}
            columns={colInfos}
            issues={at('skipRows.whenBlank')}
            disabled={ro}
          />
          <LinesField
            label={t('slot.whenKeyContains')}
            value={strs(skip.whenKeyContains)}
            onChange={(v) =>
              set({ skipRows: { ...skip, whenKeyContains: v } }, 'skipRows.whenKeyContains')
            }
            issues={at('skipRows.whenKeyContains')}
            hint={t('slot.whenKeyContainsHint')}
            disabled={ro}
            rows={2}
          />
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label={t('slot.unmerge')}
          value={str(slot.unmergeCells, 'none')}
          onChange={(v) => set({ unmergeCells: v }, 'unmergeCells')}
          options={[
            { value: 'none', label: t('slot.unmergeNone') },
            { value: 'fillDown', label: t('slot.unmergeFill') },
          ]}
          disabled={ro}
        />
        <SelectField
          label={t('slot.extraColumns')}
          value={str(slot.extraColumns, 'drop')}
          onChange={(v) => set({ extraColumns: v }, 'extraColumns')}
          options={[
            { value: 'drop', label: t('slot.extraDrop') },
            { value: 'keep', label: t('slot.extraKeep') },
          ]}
          hint={str(slot.extraColumns) === 'keep' ? t('slot.extraKeepHint') : undefined}
          disabled={ro}
        />
      </div>
      <CheckField
        label={t('slot.multiple')}
        checked={multiple.enabled === true}
        onChange={(v) => set({ multiple: { ...multiple, enabled: v } }, 'multiple.enabled')}
        hint={t('slot.multipleHint')}
        disabled={ro}
      />
      {multiple.enabled === true && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={t('slot.minFiles')}
            value={num(multiple.minFiles) ?? 1}
            min={1}
            onChange={(v) =>
              set({ multiple: { ...multiple, minFiles: v ?? 1 } }, 'multiple.minFiles')
            }
            issues={at('multiple')}
            disabled={ro}
          />
          <NumberField
            label={t('slot.maxFiles')}
            value={num(multiple.maxFiles) ?? 50}
            min={1}
            onChange={(v) =>
              set({ multiple: { ...multiple, maxFiles: v ?? 50 } }, 'multiple.maxFiles')
            }
            disabled={ro}
          />
        </div>
      )}
      <NumberField
        label={t('slot.maxRows')}
        value={num(slot.maxRows)}
        min={1}
        onChange={(v) =>
          v === undefined ? drop('maxRows', 'maxRows') : set({ maxRows: v }, 'maxRows')
        }
        issues={at('maxRows')}
        hint={t('slot.maxRowsHint')}
        disabled={ro}
      />
      <ListEditor
        label={t('slot.columns')}
        items={columns}
        onChange={(v) => set({ columns: v }, 'columns')}
        issues={at('columns')}
        create={() => ({ key: '', aliases: [], type: 'string' })}
        addLabel={t('slot.addColumn')}
        itemLabel={(i) =>
          str(columns[i]?.label) || str(columns[i]?.key) || t('slot.columnN', { n: i + 1 })
        }
        disabled={ro}
        render={(col, i) => (
          <ColumnEditor
            col={col}
            i={i}
            set={(c) =>
              onChange(
                { ...slot, columns: columns.map((x, k) => (k === i ? c : x)) },
                `slot${index}:col${i}`,
              )
            }
            issues={issues}
            ro={ro}
            doc={doc}
            slotKey={key}
            watch={watch}
          />
        )}
      />
    </div>
  );
}

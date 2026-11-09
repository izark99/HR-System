import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogFooter } from '../../../components/Dialog';
import { Checkbox, FormField, TextInput } from '../../../components/FormField';
import { Select } from '../../../components/Select';
import { Button } from '../../../components/ui';
import {
  columnProblems,
  keyFromTitle,
  looksPersonal,
  REF_TYPES,
  type RefColumn,
  type RefType,
} from './model';
import { useTypeLabel } from './shared';

/** "Thêm cột" / "Sửa cột" (spec §34 AC-RT-02): key, title, type, header names, key column. */
export function ColumnDialog({
  open,
  columns,
  index,
  onSave,
  onClose,
}: {
  open: boolean;
  columns: RefColumn[];
  /** Column edited; null = a new column. */
  index: number | null;
  onSave: (column: RefColumn) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('refTables');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={index === null ? t('column.addTitle') : t('column.editTitle')}
    >
      {open && (
        <ColumnForm
          key={index ?? 'new'}
          columns={columns}
          index={index}
          onSave={onSave}
          onCancel={onClose}
        />
      )}
    </Dialog>
  );
}

function ColumnForm({
  columns,
  index,
  onSave,
  onCancel,
}: {
  columns: RefColumn[];
  index: number | null;
  onSave: (column: RefColumn) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('refTables');
  const typeLabel = useTypeLabel();
  const start = index === null ? null : columns[index]!;
  const [title, setTitle] = useState(start?.title ?? '');
  const [key, setKey] = useState(start?.key ?? '');
  // A new column's key follows the title until the Admin types one.
  const [keyTouched, setKeyTouched] = useState(start !== null);
  const [type, setType] = useState<RefType>(start?.type ?? 'string');
  const [aliases, setAliases] = useState((start?.aliases ?? []).join(', '));
  const [isKey, setIsKey] = useState(start?.isKey ?? columns.length === 0);
  const [submitted, setSubmitted] = useState(false);

  const column: RefColumn = {
    key,
    title,
    type,
    aliases: aliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    isKey,
  };
  const list =
    index === null ? [...columns, column] : columns.map((c, i) => (i === index ? column : c));
  const problems = columnProblems(list, index ?? columns.length);
  const has = (p: string) => submitted && problems.includes(p as never);
  const personal = looksPersonal(title) || looksPersonal(key) || column.aliases.some(looksPersonal);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (problems.length === 0) onSave({ ...column, title: title.trim() });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <FormField
        id="ref-col-title"
        label={t('column.title')}
        required
        error={
          has('titleRequired')
            ? t('column.errors.titleRequired')
            : has('titleDuplicate')
              ? t('column.errors.titleDuplicate')
              : undefined
        }
      >
        {(f) => (
          <TextInput
            {...f.input}
            data-autofocus
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!keyTouched) setKey(keyFromTitle(e.target.value));
            }}
          />
        )}
      </FormField>
      <FormField
        id="ref-col-key"
        label={t('column.key')}
        required
        hint={t('column.keyHint')}
        error={
          has('keyInvalid')
            ? t('column.errors.keyInvalid')
            : has('keyDuplicate')
              ? t('column.errors.keyDuplicate')
              : undefined
        }
      >
        {(f) => (
          <TextInput
            {...f.input}
            className="font-mono"
            value={key}
            maxLength={63}
            autoComplete="off"
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.trim());
            }}
          />
        )}
      </FormField>
      <FormField id="ref-col-type" label={t('column.type')}>
        {(f) => (
          <Select
            id={f.id}
            describedBy={f.describedBy}
            value={type}
            onChange={(v) => setType(v as RefType)}
            options={REF_TYPES.map((x) => ({ value: x, label: typeLabel(x) }))}
          />
        )}
      </FormField>
      <FormField
        id="ref-col-aliases"
        label={t('column.aliases')}
        hint={t('column.aliasesHint')}
        error={has('aliasTooMany') || has('aliasTooLong') ? t('column.errors.aliases') : undefined}
      >
        {(f) => (
          <TextInput
            {...f.input}
            value={aliases}
            placeholder={t('column.aliasesPlaceholder')}
            onChange={(e) => setAliases(e.target.value)}
          />
        )}
      </FormField>
      <Checkbox
        checked={isKey}
        onChange={(e) => setIsKey(e.target.checked)}
        label={t('column.isKey')}
        hint={t('column.isKeyHint')}
      />
      {personal && (
        <p data-column-personal className="m-0 text-caption text-amber-text">
          {t('column.personalNote')}
        </p>
      )}
      <DialogFooter>
        <Button variant="text" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" variant="primary">
          {t('column.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

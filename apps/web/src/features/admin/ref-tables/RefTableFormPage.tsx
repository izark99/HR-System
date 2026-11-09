import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn } from '../../../components/DataTable';
import { Dialog, DialogFooter } from '../../../components/Dialog';
import { Checkbox, FieldGrid, FormField, TextInput } from '../../../components/FormField';
import { PencilIcon, TrashIcon } from '../../../components/icons';
import { PageHeader, Toolbar } from '../../../components/layout';
import { RowIcon, rowIconClass } from '../../../components/RowActions';
import { HeaderSkeleton, LoadingRegion, TableCardSkeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { Button, buttonClass, Callout, cardClass, Chip, cx } from '../../../components/ui';
import { useUnsavedChanges } from '../../auth/idle/activity';
import { ColumnDialog } from './ColumnDialog';
import {
  cleanColumns,
  columnChanges,
  columnProblems,
  keyFromTitle,
  personalColumns,
  TABLE_CODE_RE,
  tableProblems,
  type RefColumn,
} from './model';
import {
  refErrorOf,
  refErrorText,
  type RefApiErrorKey,
  type RefTable,
  type RefUsage,
} from './ref-tables-api';
import { BackLink, refPath, useRefApi, useTypeLabel } from './shared';

/** Flow names using the table, "Đối chiếu… (v3), Tổng hợp… (v1)". */
export function usageText(list: readonly RefUsage[]): string {
  return list.map((u) => `${u.flowName} (v${u.versionNo})`).join(', ');
}

/** Create (`code` undefined) or edit a table and its columns (spec §34 AC-RT-02, 05). */
export function RefTableFormPage({ code }: { code?: string }) {
  const { t } = useTranslation('refTables');
  const api = useRefApi();
  const [table, setTable] = useState<RefTable | null | undefined>(code ? undefined : null);
  const [usage, setUsage] = useState<RefUsage[]>([]);
  const [error, setError] = useState<RefApiErrorKey | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    api.getTable(code).then(
      (r) => {
        if (!alive) return;
        setTable(r);
        setError(null);
      },
      (e: unknown) => alive && setError(refErrorOf(e)),
    );
    api.usage().then(
      (u) => alive && setUsage(u.get(code) ?? []),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, code, tick]);

  if (error) {
    return (
      <>
        <BackLink />
        <div className="flex flex-col items-start gap-3">
          <Callout tone="coral" label={t('errorLabel')} role="alert">
            {t(refErrorText(error))}
          </Callout>
          <Button size="sm" onClick={() => setTick((n) => n + 1)}>
            {t('retry')}
          </Button>
        </div>
      </>
    );
  }
  if (table === undefined) {
    return (
      <LoadingRegion className="flex flex-col gap-6">
        <HeaderSkeleton />
        <TableCardSkeleton rows={3} columns={5} />
      </LoadingRegion>
    );
  }
  if (code && table === null) {
    return (
      <>
        <BackLink />
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {t('notFound', { code })}
        </Callout>
      </>
    );
  }
  return (
    <TableForm
      key={`${table?.id ?? 'new'}:${table?.updatedAt ?? ''}`}
      table={table}
      usage={usage}
      onReload={() => setTick((n) => n + 1)}
    />
  );
}

function TableForm({
  table,
  usage,
  onReload,
}: {
  table: RefTable | null;
  usage: RefUsage[];
  onReload: () => void;
}) {
  const { t } = useTranslation('refTables');
  const api = useRefApi();
  const toast = useToast();
  const navigate = useNavigate();
  const typeLabel = useTypeLabel();
  const [code, setCode] = useState(table?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(table !== null);
  const [name, setName] = useState(table?.name ?? '');
  const [description, setDescription] = useState(table?.description ?? '');
  const [columns, setColumns] = useState<RefColumn[]>(table?.columns ?? []);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<RefApiErrorKey | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty =
    !saved &&
    (code !== (table?.code ?? '') ||
      name !== (table?.name ?? '') ||
      description !== (table?.description ?? '') ||
      JSON.stringify(columns) !== JSON.stringify(table?.columns ?? []));
  useUnsavedChanges(dirty);
  // Set right before navigating away after a save (the render's `dirty` is still true then).
  const leaving = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const personal = personalColumns(columns);
  const changes = table ? columnChanges(table.columns, columns) : null;
  const problems = useMemo(() => {
    const out: string[] = tableProblems(code, name, columns).map((p) => t(`form.errors.${p}`));
    columns.forEach((c, i) => {
      for (const p of columnProblems(columns, i))
        out.push(
          t('form.errors.column', { column: c.title || c.key, problem: t(`column.errors.${p}`) }),
        );
    });
    return out;
  }, [code, name, columns, t]);

  async function save() {
    setSubmitted(true);
    setSaveError(null);
    if (problems.length > 0 || (personal.length > 0 && !confirmed) || busy) return;
    setBusy(true);
    try {
      await api.saveTable({
        id: table?.id ?? null,
        code,
        name: name.trim(),
        description: description.trim(),
        columns: cleanColumns(columns),
        expectedUpdatedAt: table?.updatedAt ?? null,
        personalDataColumns: personal.map((c) => c.key),
      });
      setSaved(true);
      leaving.current = true;
      toast.show({ tone: 'teal', message: t(table ? 'form.saved' : 'form.created', { code }) });
      if (table) onReload();
      else void navigate({ to: '/admin/ref-tables/$', params: refPath(code, 'versions') });
    } catch (e) {
      const key = refErrorOf(e);
      if (key === 'draft_conflict') setConflict(true);
      else setSaveError(key);
      setBusy(false);
    }
  }

  const colDefs: DataTableColumn<RefColumn>[] = [
    {
      id: 'key',
      header: t('form.col.key'),
      cell: (c) => <span className="font-mono text-caption text-ink">{c.key}</span>,
    },
    { id: 'title', header: t('form.col.title'), rowHeader: true, cell: (c) => c.title },
    { id: 'type', header: t('form.col.type'), cell: (c) => typeLabel(c.type) },
    {
      id: 'aliases',
      header: t('form.col.aliases'),
      cell: (c) => (c.aliases.length > 0 ? c.aliases.join(', ') : '–'),
    },
    {
      id: 'isKey',
      header: t('form.col.isKey'),
      cell: (c) => (c.isKey ? <Chip tone="blue">{t('keyChip')}</Chip> : '–'),
    },
  ];

  return (
    <>
      <PageHeader
        back={<BackLink />}
        title={table ? table.name : t('form.newTitle')}
        oneLineTitle
        subtitle={t('form.subtitle')}
        actions={
          <>
            {table && (
              <Link
                to="/admin/ref-tables/$"
                params={refPath(table.code, 'versions')}
                className={buttonClass('outline')}
              >
                {t('form.versions')}
              </Link>
            )}
            <Button
              variant="primary"
              disabled={busy || (personal.length > 0 && !confirmed)}
              onClick={() => void save()}
            >
              {busy ? t('saving') : t('form.save')}
            </Button>
          </>
        }
      />

      {usage.length > 0 && (
        <Callout tone="blue" label={t('form.usageLabel')}>
          {t('form.usage', {
            count: new Set(usage.map((u) => u.flowId)).size,
            flows: usageText(usage),
          })}
        </Callout>
      )}
      {changes?.any && (usage.length > 0 || table!.versions.some((v) => v.status !== 'draft')) && (
        <Callout tone="amber" label={t('form.changesLabel')} role="status">
          {[
            changes.removed.length > 0 &&
              t('form.changes.removed', { keys: changes.removed.join(', ') }),
            changes.retyped.length > 0 &&
              t('form.changes.retyped', { keys: changes.retyped.join(', ') }),
            changes.added.length > 0 && t('form.changes.added', { keys: changes.added.join(', ') }),
          ]
            .filter(Boolean)
            .join(' ')}{' '}
          {usage.length > 0 ? t('form.changes.flows', { flows: usageText(usage) }) : ''}{' '}
          {t('form.changes.published')}
        </Callout>
      )}

      <section
        aria-labelledby="ref-info-title"
        data-card
        className={cx(cardClass, 'flex min-w-0 flex-col gap-4 p-6')}
      >
        <h2 id="ref-info-title" className="m-0 text-title-sm text-ink">
          {t('form.infoTitle')}
        </h2>
        <FieldGrid cols={2}>
          <FormField
            id="ref-code"
            label={t('form.code')}
            required
            hint={t('form.codeHint')}
            error={
              submitted && !table && !TABLE_CODE_RE.test(code)
                ? t('form.errors.codeInvalid')
                : undefined
            }
          >
            {(f) => (
              <TextInput
                {...f.input}
                className="font-mono"
                value={code}
                disabled={table !== null}
                maxLength={64}
                autoComplete="off"
                onChange={(e) => {
                  setCodeTouched(true);
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''));
                }}
              />
            )}
          </FormField>
          <FormField
            id="ref-name"
            label={t('form.name')}
            required
            error={submitted && !name.trim() ? t('form.errors.nameRequired') : undefined}
          >
            {(f) => (
              <TextInput
                {...f.input}
                value={name}
                maxLength={160}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!codeTouched) setCode(keyFromTitle(e.target.value).toUpperCase());
                }}
              />
            )}
          </FormField>
        </FieldGrid>
        <FormField id="ref-description" label={t('form.description')}>
          {(f) => (
            <TextInput
              {...f.input}
              value={description}
              maxLength={1000}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </FormField>
      </section>

      <section
        aria-labelledby="ref-cols-title"
        data-card
        className={cx(cardClass, 'flex min-w-0 flex-col overflow-hidden')}
      >
        <Toolbar
          end={
            <Button size="sm" onClick={() => setEditing('new')}>
              {t('form.addColumn')}
            </Button>
          }
        >
          <h2 id="ref-cols-title" className="m-0 text-title-sm text-ink">
            {t('form.columnsTitle', { count: columns.length })}
          </h2>
        </Toolbar>
        <DataTable
          caption={t('form.columnsCaption')}
          columns={colDefs}
          rows={columns}
          rowKey={(c) => c.key || c.title}
          empty={{ title: t('form.noColumnsTitle'), text: t('form.noColumnsText') }}
          actions={{
            header: t('form.col.actions'),
            cell: (c) => {
              const i = columns.indexOf(c);
              return (
                <div data-row-actions className="flex items-center justify-end gap-2">
                  <RowIcon label={t('form.editColumn')}>
                    <button
                      type="button"
                      aria-label={t('form.editColumnFor', { key: c.key })}
                      className={cx(rowIconClass, 'hover:text-ink')}
                      onClick={() => setEditing(i)}
                    >
                      <PencilIcon />
                    </button>
                  </RowIcon>
                  <RowIcon label={t('form.removeColumn')}>
                    <button
                      type="button"
                      aria-label={t('form.removeColumnFor', { key: c.key })}
                      className={cx(rowIconClass, 'hover:text-coral-text')}
                      onClick={() => setColumns((list) => list.filter((_, j) => j !== i))}
                    >
                      <TrashIcon />
                    </button>
                  </RowIcon>
                </div>
              );
            },
          }}
        />
        {personal.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-line p-4">
            <Callout tone="amber" label={t('personal.label')} role="status">
              {t('personal.columns', { columns: personal.map((c) => `"${c.title}"`).join(', ') })}
            </Callout>
            <Checkbox
              id="ref-personal-confirm"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              label={t('personal.confirm')}
            />
          </div>
        )}
      </section>

      {submitted && problems.length > 0 && (
        <Callout tone="coral" label={t('form.problemsLabel')} role="alert">
          {problems.join(' ')}
        </Callout>
      )}
      {saveError && (
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {t(saveError === 'duplicate' ? 'form.errors.codeTaken' : refErrorText(saveError), {
            code,
          })}
        </Callout>
      )}

      <ColumnDialog
        open={editing !== null}
        columns={columns}
        index={typeof editing === 'number' ? editing : null}
        onClose={() => setEditing(null)}
        onSave={(c) => {
          setColumns((list) =>
            typeof editing === 'number'
              ? list.map((x, i) => (i === editing ? c : x))
              : [...list, c],
          );
          setEditing(null);
        }}
      />
      <Dialog open={conflict} onClose={() => setConflict(false)} title={t('conflict.title')}>
        <p className="m-0 text-body text-ink-soft">{t('conflict.tableText')}</p>
        <DialogFooter>
          <Button variant="text" onClick={() => setConflict(false)}>
            {t('conflict.stay')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setConflict(false);
              setSaved(true);
              onReload();
            }}
          >
            {t('conflict.reload')}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={blocker.status === 'blocked'}
        onClose={() => blocker.reset?.()}
        title={t('leave.title')}
      >
        <p className="m-0 text-body text-ink-soft">{t('leave.text')}</p>
        <DialogFooter>
          <Button onClick={() => blocker.reset?.()}>{t('leave.stay')}</Button>
          <Button variant="primary" onClick={() => blocker.proceed?.()}>
            {t('leave.leave')}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

import i18next from 'i18next';
import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn } from '../../../components/DataTable';
import { ConfirmDialog, Dialog, DialogFooter } from '../../../components/Dialog';
import { Checkbox, FormField, Textarea, TextInput } from '../../../components/FormField';
import { PencilIcon, ResetIcon } from '../../../components/icons';
import { PageHeader, Toolbar } from '../../../components/layout';
import { RowIcon, rowIconClass } from '../../../components/RowActions';
import { Select } from '../../../components/Select';
import { LoadingRegion, TableCardSkeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { Button, Callout, cardClass, Chip, cx } from '../../../components/ui';
import { getSupabase } from '../../../lib/supabase';
import { textVars } from '../../../lib/text-vars';
import { applyTextOverrides, setTextOverrides } from '../../../lib/ui-text';
import viUiText from '../../../locales/vi/ui-text.json';
import { errorKeyOf, type AdminErrorKey } from '../admin-api';
import { buildCatalog, UI_TEXT_GROUPS, type UiTextEntry, type UiTextGroup } from './catalog';
import {
  checkText,
  fillSample,
  foldText,
  maxLength,
  splitVars,
  valueToSave,
  type TextProblem,
} from './text-rules';
import {
  listUiTextOverrides,
  resetAllUiTexts,
  resetUiText,
  saveUiText,
  type UiTextOverride,
} from './ui-text-api';

// The tab's own texts load with its chunk (bundle budget, spec §33 AC-TX-07).
if (!i18next.hasResourceBundle('vi', 'uiText')) {
  i18next.addResourceBundle('vi', 'uiText', viUiText);
  applyTextOverrides('uiText');
}

const CATALOG = buildCatalog();

interface Row extends UiTextEntry {
  override: UiTextOverride | undefined;
  /** Text in use: the edited one, else the default. */
  current: string;
  edited: boolean;
  /** Folded "current default code" for the search. */
  haystack: string;
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Text with its `{{…}}` variables on a grey background (AC-TX-09). */
function VarText({ text }: { text: string }) {
  return (
    <>
      {splitVars(text).map((p, i) =>
        p.isVar ? (
          <span
            key={i}
            data-text-var
            className="rounded-input bg-neutral px-1 font-mono text-caption whitespace-nowrap text-ink-soft"
          >
            {p.text}
          </span>
        ) : (
          // Plain text node: wrapped lines of an inline element would overlap its neighbours.
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

function problemText(t: (k: string, o?: Record<string, unknown>) => string, p: TextProblem) {
  const vars = (list: string[]) => list.map((v) => `{{${v}}}`).join(', ');
  switch (p.kind) {
    case 'missing':
    case 'extra':
      return t(`errors.${p.kind}`, { vars: vars(p.vars) });
    case 'tooLong':
      return t('errors.tooLong', { max: p.max });
    default:
      return t(`errors.${p.kind}`);
  }
}

function EditForm({
  row,
  onSaved,
  onCancel,
}: {
  row: Row;
  onSaved: (value: string | null) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('uiText');
  const [text, setText] = useState(row.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  const need = textVars(row.text);
  const have = textVars(text);
  const problem = checkText(row.text, text);
  const max = maxLength(row.text);

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      await saveUiText(getSupabase(), row.key, value);
      onSaved(value);
    } catch (e) {
      setError(errorKeyOf(e));
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && text !== row.current) void save(valueToSave(row.text, text));
      }}
    >
      <p data-note className="m-0 font-mono text-caption text-muted">
        {row.code} · {t(`groups.${row.group}`)}
      </p>
      <div className="flex flex-col gap-2">
        <span className="text-label text-ink">{t('dialog.original')}</span>
        <div
          data-ui-text-original
          className="rounded-input bg-neutral px-3 py-2 text-body break-words text-ink-soft"
        >
          <VarText text={row.text} />
        </div>
      </div>
      <FormField
        id="ui-text-new"
        label={t('dialog.newText')}
        error={problem ? problemText(t, problem) : undefined}
      >
        {(f) => (
          <>
            <Textarea
              {...f.input}
              data-autofocus
              value={text}
              rows={3}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              aria-describedby={cx(f.describedBy, 'ui-text-meta') || undefined}
            />
            <div
              id="ui-text-meta"
              className="flex flex-wrap items-center justify-between gap-3 text-caption text-muted"
            >
              <span className="flex flex-wrap items-center gap-2">
                {need.length === 0 ? (
                  t('dialog.noVars')
                ) : (
                  <>
                    {t('dialog.varsLabel')}
                    {need.map((v) => {
                      const ok = have.includes(v);
                      return (
                        <span
                          key={v}
                          data-var-chip={ok ? 'ok' : 'missing'}
                          className={cx(
                            'rounded-pill border px-2 font-mono',
                            ok
                              ? 'border-drop-border bg-teal-tint-soft text-teal-strong'
                              : 'border-coral-text bg-coral-tint text-coral-text',
                          )}
                        >
                          <span aria-hidden>{`{{${v}}}`}</span>
                          <span className="sr-only">
                            {t(ok ? 'dialog.varPresent' : 'dialog.varMissing', { name: v })}
                          </span>
                        </span>
                      );
                    })}
                  </>
                )}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {t('dialog.length', { n: text.length, max })}
              </span>
            </div>
          </>
        )}
      </FormField>
      <div
        data-ui-text-preview
        className="flex flex-col gap-2 rounded-card border border-dashed border-drop-border bg-drop-bg px-4 py-3"
      >
        <span className="text-eyebrow text-teal-strong uppercase">{t('dialog.preview')}</span>
        <span className="text-body break-words text-ink-soft">{fillSample(text)}</span>
      </div>
      {error && (
        <Callout tone="coral" label={i18next.t('admin.errorLabel')} role="alert">
          {i18next.t(`admin.errors.${error}`)}
        </Callout>
      )}
      <DialogFooter>
        {row.edited && (
          <Button
            variant="text"
            className="mr-auto"
            disabled={busy}
            onClick={() => void save(null)}
          >
            {t('reset')}
          </Button>
        )}
        <Button variant="text" disabled={busy} onClick={onCancel}>
          {i18next.t('common.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !!problem || text === row.current}
        >
          {busy ? t('dialog.saving') : t('dialog.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function UiTextPage() {
  const { t } = useTranslation('uiText');
  const toast = useToast();
  const [overrides, setOverrides] = useState<Map<string, UiTextOverride> | null>(null);
  const [loadError, setLoadError] = useState<AdminErrorKey | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<UiTextGroup | 'all'>('all');
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const [actionError, setActionError] = useState<AdminErrorKey | null>(null);

  useEffect(() => {
    let alive = true;
    listUiTextOverrides(getSupabase()).then(
      (list) => {
        if (!alive) return;
        setOverrides(new Map(list.map((o) => [o.key, o])));
        setLoadError(null);
      },
      (e: unknown) => alive && setLoadError(errorKeyOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const reload = () => setAttempt((n) => n + 1);

  const rows = useMemo<Row[]>(() => {
    if (!overrides) return [];
    return CATALOG.map((e) => {
      const override = overrides.get(e.key);
      const value = override?.value;
      const edited = typeof value === 'string';
      const current = typeof value === 'string' ? value : e.text;
      return {
        ...e,
        override,
        edited,
        current,
        haystack: foldText(`${current}\n${e.text}\n${e.code}`),
      };
    });
  }, [overrides]);

  const deferredQuery = useDeferredValue(query);
  const shown = useMemo(() => {
    const q = foldText(deferredQuery.trim());
    return rows.filter(
      (r) =>
        (group === 'all' || r.group === group) &&
        (!onlyEdited || r.edited) &&
        (!q || r.haystack.includes(q)),
    );
  }, [rows, deferredQuery, group, onlyEdited]);
  const editedCount = rows.filter((r) => r.edited).length;

  /** Apply a change in this tab right away (AC-TX-05) and in the table. */
  function applied(changes: [string, string | null][], toastMessage: string) {
    setTextOverrides(changes);
    setOverrides((prev) => {
      const next = new Map(prev ?? []);
      for (const [key, value] of changes) {
        const old = next.get(key);
        next.set(key, {
          key,
          value,
          updatedBy: old?.updatedBy ?? null,
          updatedAt: new Date().toISOString(),
        });
      }
      return next;
    });
    toast.show({ tone: 'teal', message: toastMessage });
    // The author / time as the database recorded them.
    reload();
  }

  async function resetRow(row: Row) {
    setActionError(null);
    try {
      await resetUiText(getSupabase(), row.key);
      applied([[row.key, null]], t('toast.reset', { code: row.code }));
    } catch (e) {
      setActionError(errorKeyOf(e));
    }
  }

  async function resetAll() {
    setBusyAll(true);
    setActionError(null);
    const keys = rows.filter((r) => r.edited).map((r) => r.key);
    try {
      await resetAllUiTexts(getSupabase());
      setConfirmAll(false);
      applied(
        keys.map((k) => [k, null]),
        t('toast.resetAll', { count: keys.length }),
      );
    } catch (e) {
      setActionError(errorKeyOf(e));
    } finally {
      setBusyAll(false);
    }
  }

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'group',
      header: t('col.group'),
      cell: (r) => <Chip tone="blue">{t(`groups.${r.group}`)}</Chip>,
    },
    {
      id: 'code',
      header: t('col.code'),
      cell: (r) => <span className="font-mono text-caption text-muted">{r.code}</span>,
    },
    {
      id: 'text',
      header: t('col.text'),
      rowHeader: true,
      cell: (r) => (
        <span className="font-normal text-ink-soft">
          <VarText text={r.current} />
        </span>
      ),
    },
    {
      id: 'status',
      header: t('col.status'),
      cell: (r) =>
        r.edited ? (
          <Chip tone="amber">{t('status.edited')}</Chip>
        ) : (
          <Chip tone="neutral">{t('status.default')}</Chip>
        ),
    },
    {
      id: 'updated',
      header: t('col.updated'),
      cell: (r) => (
        <span className="text-caption text-muted">
          {r.edited && r.override
            ? t('updatedBy', {
                name: r.override.updatedBy ?? t('unknownAuthor'),
                date: stamp(r.override.updatedAt),
              })
            : '–'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        eyebrowTone="blue"
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button disabled={!overrides || editedCount === 0} onClick={() => setConfirmAll(true)}>
            {t('resetAll')}
          </Button>
        }
      />

      {actionError && (
        <Callout tone="coral" label={i18next.t('admin.errorLabel')} role="alert">
          {i18next.t(`admin.errors.${actionError}`)}
        </Callout>
      )}
      {loadError && !overrides && (
        <div className="flex flex-col items-start gap-3">
          <Callout tone="coral" label={i18next.t('admin.errorLabel')} role="alert">
            {i18next.t(`admin.errors.${loadError}`)}
          </Callout>
          <Button size="sm" onClick={reload}>
            {i18next.t('common.retry')}
          </Button>
        </div>
      )}
      {!overrides && !loadError && (
        <LoadingRegion>
          <TableCardSkeleton rows={6} columns={6} />
        </LoadingRegion>
      )}

      {overrides && (
        <section
          aria-label={t('listLabel')}
          data-card
          className={cx(cardClass, 'flex min-w-0 flex-col overflow-hidden')}
        >
          <Toolbar
            className="items-end"
            end={
              <span
                aria-live="polite"
                data-ui-text-count
                className="flex h-control items-center text-caption whitespace-nowrap text-muted tabular-nums"
              >
                {t('count', { shown: shown.length, total: rows.length, edited: editedCount })}
              </span>
            }
          >
            <FormField id="ui-text-search" label={t('search')} className="w-64 max-w-full">
              {(f) => (
                <TextInput
                  {...f.input}
                  type="search"
                  autoComplete="off"
                  value={query}
                  placeholder={t('searchPlaceholder')}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
            </FormField>
            <FormField id="ui-text-group" label={t('group')} className="w-64 max-w-full">
              {(f) => (
                <Select
                  id={f.id}
                  describedBy={f.describedBy}
                  value={group}
                  onChange={(v) => setGroup(v as UiTextGroup | 'all')}
                  options={[
                    { value: 'all', label: t('allGroups') },
                    ...UI_TEXT_GROUPS.map((g) => ({ value: g, label: t(`groups.${g}`) })),
                  ]}
                />
              )}
            </FormField>
            <div className="flex h-control items-center self-end">
              <Checkbox
                checked={onlyEdited}
                onChange={(e) => setOnlyEdited(e.target.checked)}
                label={t('onlyEdited')}
                className="whitespace-nowrap"
              />
            </div>
          </Toolbar>
          <DataTable
            caption={t('tableLabel')}
            columns={columns}
            rows={shown}
            rowKey={(r) => r.key}
            empty={{ title: t('emptyTitle'), text: t('empty') }}
            actions={{
              header: t('col.actions'),
              cell: (r) => (
                <div data-row-actions className="flex items-center justify-end gap-2">
                  <RowIcon label={t('edit')}>
                    <button
                      type="button"
                      data-edit={r.key}
                      aria-label={t('editFor', { code: r.code })}
                      className={cx(rowIconClass, 'hover:text-ink')}
                      onClick={() => {
                        setActionError(null);
                        setEditing(r);
                      }}
                    >
                      <PencilIcon />
                    </button>
                  </RowIcon>
                  <RowIcon label={t('reset')}>
                    <button
                      type="button"
                      aria-label={t('resetFor', { code: r.code })}
                      disabled={!r.edited}
                      className={cx(rowIconClass, 'hover:text-ink disabled:opacity-40')}
                      onClick={() => void resetRow(r)}
                    >
                      <ResetIcon />
                    </button>
                  </RowIcon>
                </div>
              ),
            }}
          />
        </section>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={t('dialog.title')}>
        {editing && (
          <EditForm
            key={editing.key}
            row={editing}
            onCancel={() => setEditing(null)}
            onSaved={(value) => {
              const row = editing;
              setEditing(null);
              applied(
                [[row.key, value]],
                t(value === null ? 'toast.reset' : 'toast.saved', { code: row.code }),
              );
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmAll}
        title={t('confirmAll.title', { count: editedCount })}
        description={t('confirmAll.text')}
        confirmLabel={t('confirmAll.confirm')}
        tone="danger"
        busy={busyAll}
        onConfirm={() => void resetAll()}
        onCancel={() => setConfirmAll(false)}
      />
    </>
  );
}

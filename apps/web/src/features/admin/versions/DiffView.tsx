import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Callout, Chip, cx, type Tone } from '../../../components/ui';
import type { AdminVersionDetail } from '../admin-api';
import {
  diffDefinitions,
  type ChangeKind,
  type EdgeRef,
  type ItemDiff,
  type SideBySideRow,
} from './version-diff';

const KIND_TONE: Record<ChangeKind, Tone> = { added: 'teal', removed: 'coral', changed: 'amber' };

const endpoint = (node: string, port: string | null) => (port ? `${node}.${port}` : node);
/** ASCII arrow: the UI avoids glyphs the font may lack (spec §25.4). */
const edgeText = (e: EdgeRef) => `${endpoint(e.from, e.fromPort)} -> ${endpoint(e.to, e.toPort)}`;

function SideBySide({
  rows,
  before,
  after,
}: {
  rows: SideBySideRow[];
  before: string;
  after: string;
}) {
  const cell = (line: SideBySideRow['left'], side: 'left' | 'right') => (
    <td
      className={cx(
        'w-1/2 px-3 py-0.5 align-top font-mono text-code whitespace-pre-wrap break-all',
        side === 'left' && 'border-r border-line',
        line?.change === 'removed' && 'bg-coral-tint text-coral-text',
        line?.change === 'added' && 'bg-teal-tint text-teal-strong',
        !line && 'bg-neutral',
      )}
    >
      {line ? (
        <>
          {line.change !== 'same' && (
            <span className="sr-only">{line.change === 'removed' ? '- ' : '+ '}</span>
          )}
          {line.text}
        </>
      ) : null}
    </td>
  );
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-160 border-collapse">
        <thead>
          <tr className="border-b border-line bg-neutral text-left text-muted">
            <th scope="col" className="px-3 py-2 text-dense-head">
              {before}
            </th>
            <th scope="col" className="px-3 py-2 text-dense-head">
              {after}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cell(r.left, 'left')}
              {cell(r.right, 'right')}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemList({
  title,
  items,
  before,
  after,
}: {
  title: string;
  items: ItemDiff[];
  before: string;
  after: string;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-title-sm text-ink">
        {title} ({items.length})
      </h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((item) => (
          <li key={`${item.kind}-${item.key}`} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={KIND_TONE[item.kind]}>{t(`admin.versions.diff.${item.kind}`)}</Chip>
              <span className="font-mono text-caption font-semibold">{item.key}</span>
              {item.type && <span className="text-caption text-muted">{item.type}</span>}
              {item.label && <span className="text-body">{item.label}</span>}
              {item.fields && item.fields.length > 0 && (
                <span className="text-caption text-muted">
                  {t('admin.versions.diff.fields', {
                    fields: item.fields.map((f) => t(`admin.versions.diff.field.${f}`)).join(', '),
                  })}
                </span>
              )}
            </div>
            {item.rows && <SideBySide rows={item.rows} before={before} after={after} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Differences between two versions of one flow (spec §14.3). */
export function DiffView({
  before,
  after,
}: {
  before: AdminVersionDetail;
  after: AdminVersionDetail;
}) {
  const { t } = useTranslation();
  const diff = useMemo(() => diffDefinitions(before.definition, after.definition), [before, after]);
  const left = t('admin.versions.diff.before', { version: before.versionNo });
  const right = t('admin.versions.diff.after', { version: after.versionNo });

  if (diff.identical) {
    return (
      <Callout tone="teal" label={t('admin.versions.diff.identicalLabel')} role="status">
        {t('admin.versions.diff.identical')}
      </Callout>
    );
  }
  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      <ItemList
        title={t('admin.versions.diff.nodes')}
        items={diff.nodes}
        before={left}
        after={right}
      />
      {diff.edges.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-title-sm text-ink">
            {t('admin.versions.diff.edges')} ({diff.edges.length})
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {diff.edges.map((e) => (
              <li key={`${e.kind}-${edgeText(e)}`} className="flex flex-wrap items-center gap-2">
                <Chip tone={KIND_TONE[e.kind]}>{t(`admin.versions.diff.${e.kind}`)}</Chip>
                <span className="font-mono text-caption">{edgeText(e)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ItemList
        title={t('admin.versions.diff.params')}
        items={diff.params}
        before={left}
        after={right}
      />
      <ItemList
        title={t('admin.versions.diff.inputSlots')}
        items={diff.inputSlots}
        before={left}
        after={right}
      />
      {diff.other.length > 0 && (
        <p className="m-0 text-body">
          {t('admin.versions.diff.other')}:{' '}
          <span className="font-mono">{diff.other.join(', ')}</span>
        </p>
      )}
    </div>
  );
}

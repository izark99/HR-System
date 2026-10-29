import { useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../components/Select';
import { Button, Callout, cx } from '../../components/ui';
import type { DesignCheckResult, DesignIssue } from '../../engine/design';
import { typeKey } from './catalog';
import { NodeConfigForm } from './forms/NodeForms';
import { ParamsForm } from './forms/ParamsForm';
import { SlotForm } from './forms/SlotForm';
import { FieldErrors, TextField } from './forms/fields';
import { uniqueId, type DesignerDoc, type DNode, type DNote, type JsonObject } from './model';

export interface ConfigPanelProps {
  doc: DesignerDoc;
  node: DNode | null;
  note: DNote | null;
  check: DesignCheckResult | null;
  readOnly: boolean;
  onNodeConfig: (
    id: string,
    config: JsonObject,
    mergeKey?: string,
    renames?: Record<string, string>,
  ) => void;
  onNodeLabel: (id: string, label: string) => void;
  onParams: (params: JsonObject[], mergeKey: string) => void;
  onSlots: (slots: JsonObject[], mergeKey: string) => void;
  onNote: (id: string, text: string) => void;
  onDeleteSelection: () => void;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  slotIndex: number;
  onSlotIndex: (i: number) => void;
}

export type PanelTab = 'params' | 'slots';
type Tab = PanelTab;

/** Tabs (APG pattern): arrow keys move between tabs, the panel follows. */
function Tabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { t } = useTranslation('designer');
  const tabs: Tab[] = ['params', 'slots'];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    onTab(tabs[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={t('panel.flowSettings')} className="flex gap-1.5">
      {tabs.map((x, i) => (
        <button
          key={x}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`designer-tab-${x}`}
          aria-selected={tab === x}
          aria-controls={`designer-panel-${x}`}
          tabIndex={tab === x ? 0 : -1}
          onClick={() => onTab(x)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={cx(
            'min-h-target rounded-full px-4 text-label',
            tab === x
              ? 'bg-teal-tint font-bold text-teal-strong'
              : 'font-semibold text-body hover:bg-page',
          )}
        >
          {t(`panel.tabs.${x}`)}
        </button>
      ))}
    </div>
  );
}

function SlotsTab({
  doc,
  issues,
  readOnly,
  onSlots,
  index,
  setIndex,
}: {
  doc: DesignerDoc;
  issues: readonly DesignIssue[];
  readOnly: boolean;
  onSlots: (slots: JsonObject[], mergeKey: string) => void;
  index: number;
  setIndex: (i: number) => void;
}) {
  const { t } = useTranslation('designer');
  const pickId = useId();
  const slots = doc.inputSlots;
  const current = Math.min(index, slots.length - 1);
  const slot = slots[current];
  const errorsOf = (i: number) => issues.filter((x) => x.slotIndex === i).length;
  const add = () => {
    const key = uniqueId('muc_upload', new Set(slots.map((s) => String(s.key))));
    onSlots(
      [
        ...slots,
        {
          key,
          label: t('slot.newLabel', { n: slots.length + 1 }),
          columns: [
            {
              key: 'ma_nv',
              label: t('slot.newColumn'),
              aliases: [t('slot.newColumn')],
              type: 'string',
              required: true,
            },
          ],
        },
      ],
      'slots:add',
    );
    setIndex(slots.length);
  };
  return (
    <div className="flex flex-col gap-3.5">
      <p className="m-0 text-small text-muted">{t('slot.intro')}</p>
      <div className="flex flex-wrap items-end gap-2">
        {slots.length > 0 && (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={pickId} className="text-small font-semibold text-body">
              {t('slot.pick')}
            </label>
            <Select
              id={pickId}
              value={String(current)}
              onChange={(v) => setIndex(Number(v))}
              options={slots.map((s, i) => ({
                value: String(i),
                label:
                  `${typeof s.label === 'string' && s.label ? s.label : String(s.key)}` +
                  (errorsOf(i) > 0 ? ` - ${t('status.errors', { count: errorsOf(i) })}` : ''),
              }))}
              className="w-full"
            />
          </div>
        )}
        {!readOnly && (
          <Button onClick={add} className="text-small">
            {t('slot.add')}
          </Button>
        )}
      </div>
      {slots.length === 0 && <p className="m-0 text-label text-muted">{t('slot.empty')}</p>}
      {slot && (
        <>
          <SlotForm
            key={current}
            slot={slot}
            index={current}
            issues={issues.filter((x) => x.slotIndex === current)}
            doc={doc}
            readOnly={readOnly}
            onChange={(s, mk) =>
              onSlots(
                slots.map((x, i) => (i === current ? s : x)),
                mk,
              )
            }
          />
          {!readOnly && (
            <Button
              className="self-start text-small"
              onClick={() => {
                onSlots(
                  slots.filter((_, i) => i !== current),
                  'slots:remove',
                );
                setIndex(Math.max(0, current - 1));
              }}
            >
              {t('slot.remove', { slot: typeof slot.label === 'string' ? slot.label : '' })}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function ConfigPanel(p: ConfigPanelProps) {
  const { t } = useTranslation('designer');
  const { tab, onTab: setTab } = p;
  const issues = p.check?.issues ?? [];

  if (p.note) {
    const id = `note-${p.note.id}`;
    return (
      <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3.5">
        <h2 id={`${id}-title`} className="m-0 text-section">
          {t('panel.note')}
        </h2>
        <label htmlFor={id} className="text-small font-semibold text-body">
          {t('panel.noteText')}
        </label>
        <textarea
          id={id}
          rows={6}
          value={p.note.text}
          disabled={p.readOnly}
          onChange={(e) => p.onNote(p.note!.id, e.target.value)}
          className="w-full rounded-control border border-line-input bg-card px-3 py-2 text-label"
        />
        <p className="m-0 text-small text-muted">{t('panel.noteHint')}</p>
        {!p.readOnly && (
          <Button className="self-start text-small" onClick={p.onDeleteSelection}>
            {t('panel.deleteNote')}
          </Button>
        )}
      </section>
    );
  }

  if (p.node) {
    const node = p.node;
    const nodeIssues = issues.filter((i) => i.nodeId === node.id);
    const general = nodeIssues.filter((i) => i.path === undefined);
    const warnings = general.filter((i) => i.severity === 'warning');
    const errors = general.filter((i) => i.severity === 'error');
    return (
      <section aria-labelledby="node-panel-title" className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-0.5">
          <h2 id="node-panel-title" className="m-0 text-section">
            {node.label || node.id}
          </h2>
          <p className="m-0 text-small text-muted">
            {t(`types.node.${typeKey(node.type)}`)} · <span className="font-mono">{node.id}</span>
          </p>
        </div>
        <TextField
          label={t('panel.nodeLabel')}
          value={node.label ?? ''}
          onChange={(v) => p.onNodeLabel(node.id, v)}
          placeholder={node.id}
          disabled={p.readOnly}
        />
        {errors.length > 0 && (
          <Callout tone="coral" label={t('panel.errorsLabel')} role="status">
            <FieldErrors id={`${node.id}-errors`} issues={errors} />
          </Callout>
        )}
        {warnings.length > 0 && (
          <Callout tone="amber" label={t('panel.warningsLabel')} role="status">
            <span className="flex flex-col gap-1">
              {warnings.map((w, i) => (
                <span key={i}>{w.text}</span>
              ))}
            </span>
          </Callout>
        )}
        {p.check?.nodes[node.id]?.status === 'blocked' && (
          <Callout tone="neutral" label={t('panel.noteLabel')}>
            {t('canvas.blocked')}
          </Callout>
        )}
        <NodeConfigForm
          node={node}
          info={p.check?.nodes[node.id]}
          issues={nodeIssues.filter((i) => i.path !== undefined)}
          doc={p.doc}
          readOnly={p.readOnly}
          onConfig={(config, mk, renames) => p.onNodeConfig(node.id, config, mk, renames)}
        />
        {!p.readOnly && (
          <Button className="self-start text-small" onClick={p.onDeleteSelection}>
            {t('panel.deleteNode')}
          </Button>
        )}
      </section>
    );
  }

  return (
    <section aria-label={t('panel.flowSettings')} className="flex flex-col gap-3.5">
      <Tabs tab={tab} onTab={setTab} />
      <div
        role="tabpanel"
        id={`designer-panel-${tab}`}
        aria-labelledby={`designer-tab-${tab}`}
        className="flex flex-col gap-3.5"
      >
        {tab === 'params' ? (
          <ParamsForm
            doc={p.doc}
            issues={issues.filter((i) => i.paramIndex !== undefined)}
            readOnly={p.readOnly}
            onChange={p.onParams}
          />
        ) : (
          <SlotsTab
            doc={p.doc}
            issues={issues.filter((i) => i.slotIndex !== undefined)}
            readOnly={p.readOnly}
            onSlots={p.onSlots}
            index={p.slotIndex}
            setIndex={p.onSlotIndex}
          />
        )}
      </div>
    </section>
  );
}

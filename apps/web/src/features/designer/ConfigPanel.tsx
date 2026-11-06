import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '../../components/FormField';
import { Select } from '../../components/Select';
import { TabPanel, Tabs } from '../../components/Tabs';
import { Button, Callout } from '../../components/ui';
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
  onParams: (params: JsonObject[], mergeKey: string | undefined) => void;
  onSlots: (slots: JsonObject[], mergeKey: string | undefined) => void;
  onNote: (id: string, text: string) => void;
  onDeleteSelection: () => void;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  slotIndex: number;
  onSlotIndex: (i: number) => void;
}

export type PanelTab = 'params' | 'slots';
type Tab = PanelTab;

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
  onSlots: (slots: JsonObject[], mergeKey: string | undefined) => void;
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
      undefined,
    );
    setIndex(slots.length);
  };
  return (
    <div className="flex flex-col gap-stack-dense">
      <p className="m-0 text-caption text-muted">{t('slot.intro')}</p>
      <div className="flex flex-wrap items-end gap-2">
        {slots.length > 0 && (
          <FormField dense id={pickId} label={t('slot.pick')} className="flex-1">
            {(f) => (
              <Select
                dense
                id={f.id}
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
            )}
          </FormField>
        )}
        {!readOnly && (
          // 44px like the Select beside it, 14px/600 text of the dense form (AC-UI-78 rule 8).
          <Button size="dense" onClick={add}>
            {t('slot.add')}
          </Button>
        )}
      </div>
      {slots.length === 0 && <p className="m-0 text-dense text-muted">{t('slot.empty')}</p>}
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
              size="sm"
              className="self-start"
              onClick={() => {
                onSlots(
                  slots.filter((_, i) => i !== current),
                  undefined,
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
      <section aria-labelledby={`${id}-title`} className="flex flex-col gap-stack-dense">
        <h2 id={`${id}-title`} className="m-0 text-title-sm">
          {t('panel.note')}
        </h2>
        <FormField dense id={id} label={t('panel.noteText')} hint={t('panel.noteHint')}>
          {(f) => (
            <textarea
              {...f.input}
              rows={6}
              value={p.note!.text}
              disabled={p.readOnly}
              onChange={(e) => p.onNote(p.note!.id, e.target.value)}
              className="w-full rounded-input border border-line-input bg-card px-3 py-2 text-dense"
            />
          )}
        </FormField>
        {!p.readOnly && (
          <Button variant="danger" size="sm" className="self-start" onClick={p.onDeleteSelection}>
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
      <section aria-labelledby="node-panel-title" className="flex flex-col gap-stack-dense">
        <div className="flex flex-col gap-0.5">
          <h2 id="node-panel-title" className="m-0 text-title-sm">
            {node.label || node.id}
          </h2>
          <p className="m-0 text-caption text-muted">
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
          <Button variant="danger" size="sm" className="self-start" onClick={p.onDeleteSelection}>
            {t('panel.deleteNode')}
          </Button>
        )}
      </section>
    );
  }

  return (
    <section aria-label={t('panel.flowSettings')} className="flex flex-col gap-stack-dense">
      <Tabs
        id="designer"
        dense
        label={t('panel.flowSettings')}
        selected={tab}
        onChange={(x) => setTab(x as Tab)}
        items={(['params', 'slots'] as const).map((x) => ({ id: x, label: t(`panel.tabs.${x}`) }))}
      />
      <TabPanel
        tabsId="designer"
        item={tab}
        focusable={false}
        className="flex flex-col gap-stack-dense"
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
      </TabPanel>
    </section>
  );
}

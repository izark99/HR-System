import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../../../components/ui';
import type { DesignIssue, DesignNodeStatus } from '../../../engine/design';
import type { NodeGroup, PortSpec } from '../catalog';

/**
 * Canvas cards (spec §25.3 "Node trên canvas"): radius 16px, colour bar by group, ring when
 * selected, coral 2px border on error (amber on warning only), tooltip with the messages on hover
 * and keyboard focus (the React Flow wrapper is the focusable element, see designer.css).
 */

export const GROUP_BAR: Record<NodeGroup, string> = {
  input: 'bg-blue',
  transform: 'bg-teal',
  control: 'bg-coral',
  code: 'bg-muted',
  output: 'bg-amber',
};

export interface FlowCardData extends Record<string, unknown> {
  label: string;
  typeLabel: string;
  group: NodeGroup;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** Columns of the first output port (null: unknown). */
  columnCount: number | null;
  status: DesignNodeStatus | 'checking';
  errors: DesignIssue[];
  warnings: DesignIssue[];
  readOnly: boolean;
}

export type FlowCardNode = Node<FlowCardData, 'flow'>;

function ErrorBadge({ tone }: { tone: 'coral' | 'amber' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden
      className={tone === 'coral' ? 'text-coral-text' : 'text-amber-text'}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </svg>
  );
}

function FlowCardImpl({ data, selected }: NodeProps<FlowCardNode>) {
  const { t } = useTranslation('designer');
  const hasError = data.errors.length > 0;
  const hasWarning = !hasError && data.warnings.length > 0;
  const rows = Math.max(data.inputs.length, data.outputs.length);
  return (
    <div
      className={cx(
        'relative w-65 rounded-tile bg-card shadow-card',
        hasError
          ? 'border-2 border-coral'
          : hasWarning
            ? 'border-2 border-amber'
            : 'border border-line',
        selected && 'ring-3 ring-teal-strong ring-offset-2',
      )}
    >
      <div className={cx('h-2 rounded-t-[14px]', GROUP_BAR[data.group])} aria-hidden />
      <div className="flex items-start justify-between gap-2 px-3.5 pt-2.5">
        <div className="min-w-0">
          <p className="m-0 truncate text-label font-bold text-ink">{data.label}</p>
          <p className="m-0 truncate text-small text-muted">{data.typeLabel}</p>
        </div>
        {(hasError || hasWarning) && <ErrorBadge tone={hasError ? 'coral' : 'amber'} />}
      </div>
      <p className="m-0 px-3.5 pt-1 text-small text-muted">
        {data.status === 'checking'
          ? t('canvas.checking')
          : data.status === 'blocked'
            ? t('canvas.blocked')
            : data.columnCount !== null
              ? t('canvas.columns', { count: data.columnCount })
              : data.outputs.length === 0
                ? t('canvas.noOutput')
                : t('canvas.columnsUnknown')}
      </p>
      <div className="flex flex-col gap-0.5 py-2">
        {Array.from({ length: rows }, (_, i) => {
          const input = data.inputs[i];
          const output = data.outputs[i];
          return (
            <div key={i} className="relative flex h-6.5 items-center justify-between text-small">
              <span className="relative pl-3.5 text-body">
                {input && (
                  <>
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={input.name}
                      isConnectable={!data.readOnly}
                      className="hr-handle"
                      aria-label={t('canvas.inPort', { port: input.name })}
                    />
                    {input.name}
                    {input.required && (
                      <span aria-hidden className="text-coral-text">
                        {' '}
                        *
                      </span>
                    )}
                  </>
                )}
              </span>
              <span className="relative pr-3.5 text-right text-body">
                {output && (
                  <>
                    {output.name}
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={output.name}
                      isConnectable={!data.readOnly}
                      className="hr-handle"
                      aria-label={t('canvas.outPort', { port: output.name })}
                    />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {(hasError || data.warnings.length > 0) && (
        <div role="tooltip" className="hr-node-tip">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {data.errors.map((e, i) => (
              <li key={`e${i}`} className="text-coral-text">
                {e.text}
              </li>
            ))}
            {data.warnings.map((w, i) => (
              <li key={`w${i}`} className="text-amber-text">
                {w.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const FlowCard = memo(FlowCardImpl);

export interface NoteCardData extends Record<string, unknown> {
  text: string;
  placeholder: string;
}

export type NoteCardNode = Node<NoteCardData, 'note'>;

function NoteCardImpl({ data, selected }: NodeProps<NoteCardNode>) {
  return (
    <div
      className={cx(
        'w-55 min-h-20 rounded-tile border border-amber bg-amber-tint px-3.5 py-3 text-label whitespace-pre-wrap text-body shadow-soft',
        selected && 'ring-3 ring-teal-strong ring-offset-2',
      )}
    >
      {data.text || <span className="text-muted">{data.placeholder}</span>}
    </div>
  );
}

export const NoteCard = memo(NoteCardImpl);

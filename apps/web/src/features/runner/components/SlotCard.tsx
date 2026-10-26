import type { InputSlot } from '@hrflow/flow-schema';
import { useId, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CheckIcon,
  CloseIcon,
  cx,
  toneText,
  toneTint,
  type Tone,
} from '../../../components/ui';
import type { SlotState } from '../run-store';

interface FileStatus {
  tone: Tone;
  text: string;
  ok: boolean;
}

/** One input slot: multi-file drop zone + picker and the per-file validation status. */
export function SlotCard({
  slot,
  state,
  disabled,
  onAdd,
  onRemove,
}: {
  slot: InputSlot;
  state: SlotState;
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: number) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const headingId = useId();
  const inputId = useId();
  const multiple = slot.multiple.enabled;
  const report = state.validation?.report;

  const status = (name: string): FileStatus | null => {
    if (state.validating) return { tone: 'neutral', text: t('slot.validating'), ok: false };
    if (state.failed) return { tone: 'coral', text: t('slot.readFailed'), ok: false };
    if (!report) return null;
    const issues = report.issues.filter((i) => i.file === name);
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.length - errors;
    if (errors > 0) return { tone: 'coral', text: t('slot.errors', { count: errors }), ok: false };
    if (warnings > 0) {
      return { tone: 'amber', text: t('slot.warnings', { count: warnings }), ok: false };
    }
    const rows = report.files.find((f) => f.file === name)?.dataRows ?? 0;
    return { tone: 'teal', text: t('slot.rows', { count: rows }), ok: true };
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = [...e.dataTransfer.files];
    if (files.length > 0) onAdd(files);
  };

  return (
    <Card aria-labelledby={headingId} className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="m-0 text-section text-ink">
          {slot.label}
          {slot.required && (
            <>
              <span aria-hidden> *</span>
              <span className="sr-only"> ({t('common.required')})</span>
            </>
          )}
        </h2>
        <span className="text-small text-muted">
          {t(multiple ? 'slot.multiple' : 'slot.single', { accept: slot.accept.join(' ') })}
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'rounded-tile border-2 border-dashed border-drop-border bg-drop-bg p-5 text-center text-label text-body',
          dragging && 'border-teal-strong bg-teal-tint',
          disabled && 'opacity-60',
        )}
      >
        {dragging ? (
          t('slot.dropActive', { slot: slot.label })
        ) : (
          <>
            {t('slot.drop')}{' '}
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="min-h-target rounded-control px-2 font-semibold text-teal-strong underline hover:text-teal-hover disabled:cursor-not-allowed"
            >
              {t('slot.choose')}
            </button>
          </>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple={multiple}
          accept={slot.accept.join(',')}
          aria-label={t('slot.chooseFor', { slot: slot.label })}
          disabled={disabled}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length > 0) onAdd(files);
          }}
        />
      </div>

      {state.files.length > 0 && (
        <ul
          aria-label={t('slot.files', { slot: slot.label })}
          aria-live="polite"
          className="m-0 flex list-none flex-col gap-2 p-0 text-label"
        >
          {state.files.map((f) => {
            const s = status(f.file.name);
            return (
              <li
                key={f.id}
                className={cx(
                  'flex items-center justify-between gap-2 rounded-control py-1 pr-1 pl-3.5',
                  s && s.tone !== 'teal' && s.tone !== 'neutral' ? toneTint[s.tone] : 'bg-page',
                )}
              >
                <span className="min-w-0 break-all">{f.file.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {s && (
                    <span
                      className={cx('flex items-center gap-1 font-bold', toneText[s.tone])}
                      data-testid="file-status"
                    >
                      {s.text}
                      {s.ok && <CheckIcon />}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemove(f.id)}
                    aria-label={t('slot.remove', { name: f.file.name })}
                    className="flex size-target items-center justify-center rounded-control text-muted hover:bg-neutral hover:text-ink disabled:cursor-not-allowed"
                  >
                    <CloseIcon />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

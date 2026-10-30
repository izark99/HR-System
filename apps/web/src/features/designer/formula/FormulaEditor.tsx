import { useEffect, useRef } from 'react';
import {
  FORMULA_LANGUAGE,
  monaco,
  setFormulaContext,
  type FormulaCompletionContext,
} from './monaco-formula';

/** Problem found while typing (offsets in the shown text). */
export interface FormulaMarker {
  start: number;
  end: number;
  message: string;
}

/** Recheck delay after the last keystroke (spec §12.2, AC-B4-41). */
export const CHECK_DELAY_MS = 300;

/**
 * Monaco editor of one formula column (lazy chunk, with the SQL editor's Monaco). The document
 * stores `[key]`; the editor shows `[Tiêu đề]` (spec §12.2): `toDisplay` / `toStored` convert.
 * Typing reports the stored text; external changes (undo, reload) replace the shown text.
 */
export default function FormulaEditor({
  value,
  onChange,
  toDisplay,
  toStored,
  validate,
  readOnly,
  label,
  describedBy,
  invalid,
  completion,
  refsKey,
  testId,
}: {
  value: string;
  onChange: (stored: string) => void;
  toDisplay: (stored: string) => string;
  toStored: (shown: string) => string;
  validate: (shown: string) => FormulaMarker | null;
  readOnly: boolean;
  label: string;
  describedBy?: string;
  invalid: boolean;
  completion: FormulaCompletionContext;
  /** Changes when the referenceable columns (titles) change: the text is shown again. */
  refsKey: string;
  testId?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef({ onChange, toDisplay, toStored, validate, completion });
  /** Stored texts reported by typing that have not come back as `value` yet. */
  const emitted = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latest.current = { onChange, toDisplay, toStored, validate, completion };
  });

  const check = () => {
    const ed = editor.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    const m = latest.current.validate(model.getValue());
    const markers: monaco.editor.IMarkerData[] = [];
    if (m) {
      const a = model.getPositionAt(m.start);
      const b = model.getPositionAt(Math.max(m.end, m.start + 1));
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: m.message,
        startLineNumber: a.lineNumber,
        startColumn: a.column,
        endLineNumber: b.lineNumber,
        endColumn: b.column,
      });
    }
    monaco.editor.setModelMarkers(model, FORMULA_LANGUAGE, markers);
  };

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      value: latest.current.toDisplay(value),
      language: FORMULA_LANGUAGE,
      readOnly,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 6,
      fixedOverflowWidgets: true,
      ariaLabel: label,
      wordWrap: 'on',
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      scrollbar: { vertical: 'auto', horizontal: 'hidden' },
      suggest: { showWords: false },
      quickSuggestions: { other: true, strings: false, comments: false },
      editContext: false,
    });
    editor.current = ed;
    const model = ed.getModel()!;
    setFormulaContext(model, latest.current.completion);
    const sub = ed.onDidChangeModelContent(() => {
      const stored = latest.current.toStored(ed.getValue());
      emitted.current.push(stored);
      if (emitted.current.length > 200) emitted.current.shift();
      latest.current.onChange(stored);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(check, CHECK_DELAY_MS);
    });
    check();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      sub.dispose();
      model.dispose();
      ed.dispose();
      editor.current = null;
    };
    // Created once; value/readOnly updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const echo = emitted.current.indexOf(value);
    if (echo >= 0) {
      emitted.current.splice(0, echo + 1);
      return;
    }
    const shown = latest.current.toDisplay(value);
    if (shown !== ed.getValue()) {
      emitted.current = [];
      ed.setValue(shown);
    }
  }, [value]);
  useEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly]);
  useEffect(() => {
    // Titles arrived or changed upstream (AC-B4-04): show the stored formula with the new titles,
    // unless the Admin is typing in it.
    const ed = editor.current;
    if (!ed || ed.hasTextFocus()) return;
    const shown = latest.current.toDisplay(value);
    if (shown !== ed.getValue() && latest.current.toStored(ed.getValue()) === value) {
      ed.setValue(shown);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey]);
  useEffect(() => {
    const model = editor.current?.getModel();
    if (model) setFormulaContext(model, completion);
    // Columns upstream changed: recheck the shown text.
    check();
  }, [completion]);

  return (
    <div
      ref={host}
      data-testid={testId ?? 'formula-editor'}
      aria-describedby={describedBy}
      className={
        'h-21 w-full overflow-hidden rounded-control border bg-card py-1 ' +
        (invalid ? 'border-2 border-coral' : 'border-line-input')
      }
    />
  );
}

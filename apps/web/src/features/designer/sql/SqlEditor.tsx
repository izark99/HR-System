import { useEffect, useRef } from 'react';
import { monaco, setCompletionContext, type SqlCompletionContext } from './monaco';

/**
 * Monaco SQL editor of the code.sql form (lazy chunk). Controlled: external value changes (undo,
 * reload) replace the text; typing reports every change.
 */
export default function SqlEditor({
  value,
  onChange,
  readOnly,
  label,
  describedBy,
  invalid,
  completion,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  label: string;
  describedBy?: string;
  invalid: boolean;
  completion: SqlCompletionContext;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const change = useRef(onChange);
  /**
   * Texts the editor reported that have not come back as `value` yet. While typing fast the echo
   * lags several keystrokes behind; such a `value` is ours, not an external edit (undo, reload).
   */
  const emitted = useRef<string[]>([]);
  const ctx = useRef(completion);
  useEffect(() => {
    change.current = onChange;
    ctx.current = completion;
  });

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      value,
      language: 'sql',
      readOnly,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbersMinChars: 3,
      fixedOverflowWidgets: true,
      ariaLabel: label,
      tabSize: 2,
      wordWrap: 'on',
      // A real <textarea> for input: page-level key handlers (React Flow, Designer shortcuts)
      // recognise it as a text field.
      editContext: false,
    });
    editor.current = ed;
    const sub = ed.onDidChangeModelContent(() => {
      const text = ed.getValue();
      emitted.current.push(text);
      if (emitted.current.length > 200) emitted.current.shift();
      change.current(text);
    });
    const focus = ed.onDidFocusEditorText(() => setCompletionContext(ctx.current));
    setCompletionContext(ctx.current);
    return () => {
      sub.dispose();
      focus.dispose();
      ed.getModel()?.dispose();
      ed.dispose();
      editor.current = null;
    };
    // Created once; value/readOnly updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ed = editor.current;
    // Only external changes (undo, reload): echoes of typing arrive late and must not reset the
    // text and cursor.
    if (!ed) return;
    const echo = emitted.current.indexOf(value);
    if (echo >= 0) {
      emitted.current.splice(0, echo + 1);
      return;
    }
    if (value !== ed.getValue()) {
      emitted.current = [];
      ed.setValue(value);
    }
  }, [value]);
  useEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly]);
  useEffect(() => {
    if (editor.current?.hasTextFocus()) setCompletionContext(completion);
  }, [completion]);

  return (
    <div
      ref={host}
      data-testid="sql-editor"
      aria-describedby={describedBy}
      className={
        'h-65 w-full overflow-hidden rounded-control border bg-card ' +
        (invalid ? 'border-2 border-coral' : 'border-line-input')
      }
    />
  );
}

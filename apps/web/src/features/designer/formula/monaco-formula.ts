/**
 * Monaco language of the `transform.formula` editor (spec §12.2 "Designer"): highlighting,
 * column suggestions after `[`, function suggestions with Vietnamese signature, hover on function
 * names. Same Monaco bundle as the SQL editor (Designer chunk only, MEMORY 2026-10-27 07:31).
 */
import { monaco } from '../sql/monaco';
import { escapeRef } from '../../../engine/formula/refs';

export const FORMULA_LANGUAGE = 'hrformula';

export interface FormulaFunctionDoc {
  name: string;
  syntax: string;
  desc: string;
}

export interface FormulaCompletionContext {
  columns: { key: string; title: string; type: string }[];
  functions: FormulaFunctionDoc[];
}

/** Context per editor model (one Monaco editor per formula column). */
const contexts = new WeakMap<monaco.editor.ITextModel, FormulaCompletionContext>();

export function setFormulaContext(model: monaco.editor.ITextModel, ctx: FormulaCompletionContext) {
  contexts.set(model, ctx);
}

monaco.languages.register({ id: FORMULA_LANGUAGE });

monaco.languages.setMonarchTokensProvider(FORMULA_LANGUAGE, {
  ignoreCase: true,
  tokenizer: {
    root: [
      [/"/, { token: 'string.quote', next: '@string' }],
      [/\[/, { token: 'variable', next: '@ref' }],
      [/\b(TRUE|FALSE)\b/, 'keyword'],
      [/[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/, 'type.identifier'],
      [/\d+(\.\d*)?([eE][+-]?\d+)?|\.\d+/, 'number'],
      [/[=<>&+\-*/^%]/, 'operator'],
      [/[(),]/, 'delimiter'],
    ],
    string: [
      [/""/, 'string.escape'],
      [/"/, { token: 'string.quote', next: '@pop' }],
      [/[^"]+/, 'string'],
    ],
    ref: [
      [/\]\]/, 'variable'],
      [/\]/, { token: 'variable', next: '@pop' }],
      [/[^\]]+/, 'variable'],
    ],
  },
});

monaco.languages.setLanguageConfiguration(FORMULA_LANGUAGE, {
  brackets: [
    ['(', ')'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
  wordPattern: /[A-Za-z_][A-Za-z0-9_.]*/,
});

/** Text of the current line before the cursor. */
function before(model: monaco.editor.ITextModel, position: monaco.Position): string {
  return model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
}

monaco.languages.registerCompletionItemProvider(FORMULA_LANGUAGE, {
  triggerCharacters: ['['],
  provideCompletionItems(model, position) {
    const ctx = contexts.get(model);
    if (!ctx) return { suggestions: [] };
    const K = monaco.languages.CompletionItemKind;
    const text = before(model, position);
    // Inside an open column reference: `[` then any text without `]`.
    const open = /\[([^\]]*)$/.exec(text);
    if (open) {
      const start = position.column - open[1]!.length;
      const after = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column + 1,
      });
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: start,
        endColumn: position.column + (after === ']' ? 1 : 0),
      };
      return {
        suggestions: ctx.columns.map((c, i) => ({
          label: { label: c.title, description: `${c.key} · ${c.type}` },
          // `[` is already typed: insert the rest of the escaped reference.
          insertText: escapeRef(c.title).slice(1),
          filterText: `${c.title} ${c.key}`,
          sortText: String(i).padStart(4, '0'),
          kind: K.Field,
          detail: `${c.key} · ${c.type}`,
          range,
        })),
      };
    }
    const word = model.getWordUntilPosition(position);
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
    return {
      suggestions: ctx.functions.map((f) => ({
        label: f.name,
        insertText: `${f.name}(`,
        kind: K.Function,
        detail: f.syntax,
        documentation: f.desc,
        range,
      })),
    };
  },
});

monaco.languages.registerHoverProvider(FORMULA_LANGUAGE, {
  provideHover(model, position) {
    const ctx = contexts.get(model);
    const word = model.getWordAtPosition(position);
    if (!ctx || !word) return null;
    const f = ctx.functions.find((x) => x.name === word.word.toUpperCase());
    if (!f) return null;
    return {
      range: new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      ),
      contents: [{ value: `**${f.syntax}**` }, { value: f.desc }],
    };
  },
});

export { monaco };

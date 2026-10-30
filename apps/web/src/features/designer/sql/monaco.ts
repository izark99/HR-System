/**
 * Monaco for the code.sql editor (spec §5, MEMORY 2026-10-27 07:31): bundled from npm (no CDN, no
 * AMD loader), loaded only when an SQL form opens, editor worker from the app origin, codicon font
 * bundled by Vite into /assets. Only the pieces the SQL editor needs are registered.
 */
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
// The contributions of monaco's editor.main.js without its language packages (no TS/JSON/CSS
// workers): suggest, find, hover, folding, etc.
import 'monaco-editor/editor/contrib/anchorSelect/browser/anchorSelect.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/caretOperations/browser/transpose.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/editor/contrib/codelens/browser/codelensController.js';
import '@hrflow/monaco-css/base/browser/ui/codicons/codicon/codicon.css';
import 'monaco-editor/editor/contrib/colorPicker/browser/colorPickerContribution.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution.js';
import 'monaco-editor/editor/contrib/diffEditorBreadcrumbs/browser/contribution.js';
import 'monaco-editor/editor/contrib/dnd/browser/dnd.js';
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols.js';
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/dropIntoEditorContribution.js';
import 'monaco-editor/features/find/register.js';
import 'monaco-editor/editor/contrib/floatingMenu/browser/floatingMenu.contribution.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/fontZoom/browser/fontZoom.js';
import 'monaco-editor/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js';
import 'monaco-editor/editor/contrib/gpu/browser/gpuActions.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution.js';
import 'monaco-editor/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution.js';
import 'monaco-editor/editor/contrib/inlineProgress/browser/inlineProgress.js';
import 'monaco-editor/editor/contrib/inPlaceReplace/browser/inPlaceReplace.js';
import 'monaco-editor/editor/contrib/insertFinalNewLine/browser/insertFinalNewLine.js';
import 'monaco-editor/editor/standalone/browser/inspectTokens/inspectTokens.js';
import 'monaco-editor/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard.js';
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/linkedEditing/browser/linkedEditing.js';
import 'monaco-editor/editor/contrib/links/browser/links.js';
import 'monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper.js';
import 'monaco-editor/editor/contrib/middleScroll/browser/middleScroll.contribution.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js';
import 'monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess.js';
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js';
import 'monaco-editor/editor/standalone/browser/referenceSearch/standaloneReferenceSearch.js';
import 'monaco-editor/editor/contrib/rename/browser/rename.js';
import 'monaco-editor/editor/contrib/sectionHeaders/browser/sectionHeaders.js';
import 'monaco-editor/editor/contrib/semanticTokens/browser/viewportSemanticTokens.js';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect.js';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js';
import 'monaco-editor/editor/contrib/stickyScroll/browser/stickyScrollContribution.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestInlineCompletions.js';
import 'monaco-editor/editor/standalone/browser/toggleHighContrast/toggleHighContrast.js';
import 'monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js';
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization.js';
import 'monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js';
import 'monaco-editor/editor/contrib/unusualLineTerminators/browser/unusualLineTerminators.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations.js';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js';
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus.js';
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/common/standaloneStrings.js';
import '@hrflow/monaco-css/base/browser/ui/codicons/codicon/codicon-modifiers.css';
import 'monaco-editor/languages/definitions/sql/register.js';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker({ name: 'hrflow-sql-editor' }),
};

export interface SqlCompletionContext {
  /** View names (input ports) with their columns. */
  views: { name: string; columns: { key: string; title: string; type: string }[] }[];
  /** Declared params (`$key`). */
  params: { key: string; label: string }[];
}

const KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'ON',
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS NULL',
  'IS NOT NULL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'DISTINCT',
  'LIMIT',
  'UNION ALL',
  'WITH',
  'CAST',
  'COALESCE',
  'SUM',
  'COUNT',
  'AVG',
  'MIN',
  'MAX',
  'DECIMAL(38,10)',
  'VARCHAR',
  'DATE',
];

/** Context of the editor that has focus (one SQL form is open at a time). */
let active: SqlCompletionContext = { views: [], params: [] };
export function setCompletionContext(ctx: SqlCompletionContext): void {
  active = ctx;
}

monaco.languages.registerCompletionItemProvider('sql', {
  triggerCharacters: ['$', '.'],
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    };
    const before = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: word.startColumn,
    });
    const K = monaco.languages.CompletionItemKind;
    if (before.endsWith('$')) {
      return {
        suggestions: active.params.map((p) => ({
          label: `$${p.key}`,
          insertText: p.key,
          kind: K.Variable,
          detail: p.label,
          range,
        })),
      };
    }
    const dotted = /([a-z_][a-z0-9_]*)\.$/.exec(before);
    if (dotted) {
      const view = active.views.find((v) => v.name === dotted[1]);
      return {
        suggestions: (view?.columns ?? []).map((c) => ({
          label: c.key,
          insertText: c.key,
          kind: K.Field,
          detail: `${c.title} · ${c.type}`,
          range,
        })),
      };
    }
    return {
      suggestions: [
        ...active.views.map((v) => ({
          label: v.name,
          insertText: v.name,
          kind: K.Class,
          detail: 'view',
          range,
        })),
        ...active.views.flatMap((v) =>
          v.columns.map((c) => ({
            label: c.key,
            insertText: c.key,
            kind: K.Field,
            detail: `${v.name} · ${c.title} · ${c.type}`,
            range,
          })),
        ),
        ...active.params.map((p) => ({
          label: `$${p.key}`,
          insertText: `$${p.key}`,
          kind: K.Variable,
          detail: p.label,
          range,
        })),
        ...KEYWORDS.map((k) => ({ label: k, insertText: k, kind: K.Keyword, range })),
      ],
    };
  },
});

export { monaco };

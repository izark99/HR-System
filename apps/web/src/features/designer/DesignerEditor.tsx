import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { Link, useBlocker } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Callout, Chip, cx } from '../../components/ui';
import type { DesignIssue } from '../../engine/design';
import type { Json } from '../../lib/database.types';
import { saveFile } from '../../lib/download';
import { errorKeyOf, type AdminVersionDetail } from '../admin/admin-api';
import { Dialog } from '../admin/Dialog';
import { useAdminApi } from '../admin/use-admin';
import { VERSION_STATUS_TONE } from '../admin/versions/FlowVersionsPage';
import { useUnsavedChanges } from '../auth/idle/activity';
import { FlowCard, NoteCard, type FlowCardNode, type NoteCardNode } from './canvas/nodes';
import { groupOf, inputPortsOf, outputPortsOf, typeKey } from './catalog';
import { ConfigPanel, type PanelTab } from './ConfigPanel';
import {
  addNode,
  addNote,
  autoLayout,
  commit,
  connect,
  copySelection,
  edgeId,
  history,
  moveElements,
  NODE_WIDTH,
  paste,
  redo,
  removeElements,
  toDefinition,
  undo,
  updateNode,
  updateNote,
  type Clip,
  type DesignerDoc,
  type History,
  type JsonObject,
  type XY,
} from './model';
import { DataPanel } from './DataPanel';
import { DRAG_MIME, Palette } from './Palette';
import { StatusBar } from './StatusBar';
import { useDesignCheck } from './use-design-check';

/** In-app clipboard (configuration only, never data; spec §15.3). Shared between Designers. */
let clipboard: Clip | null = null;

const nodeTypes = { flow: FlowCard, note: NoteCard };

interface Selection {
  nodes: string[];
  notes: string[];
  edges: string[];
}
const NONE: Selection = { nodes: [], notes: [], edges: [] };

/** Focus on the canvas (a node, an edge, the pane) or nowhere in particular (body). */
function onCanvas(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target === document.body) return true;
  if (isEditable(target)) return false;
  const flow = target.closest('.react-flow');
  if (!flow) return false;
  // Inside the canvas: nodes, edges and the pane; not the zoom controls or the minimap.
  return !target.closest('.react-flow__controls,.react-flow__minimap,button,input,select,textarea');
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit'].includes(type);
}

/** Document nodes + what React Flow measured / is dragging. */
function mergeRf(built: Node[], state: readonly Node[]): Node[] {
  const old = new Map(state.map((n) => [n.id, n]));
  return built.map((n) => {
    const p = old.get(n.id);
    if (!p) return n;
    return {
      ...n,
      ...(p.measured ? { measured: p.measured } : {}),
      ...(p.dragging ? { position: p.position, dragging: true } : {}),
    };
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export interface DesignerEditorProps {
  flowCode: string;
  flowName: string;
  version: AdminVersionDetail;
  initial: DesignerDoc;
  readOnly: boolean;
  /** Reload the flow from the server (discards the local history). */
  onReload: () => void;
  onCreateDraft: () => void;
  creatingDraft: boolean;
  /** Latest definition on the canvas (kept by the page for the crash fallback). */
  onDefinition?: (definition: JsonObject) => void;
}

export function DesignerEditor(props: DesignerEditorProps) {
  const { t } = useTranslation('designer');
  const { t: tc } = useTranslation();
  const api = useAdminApi();
  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const ro = props.readOnly;

  const [hist, setHist] = useState<History>(() => history(props.initial));
  const doc = hist.present;
  const definition = useMemo(() => toDefinition(doc), [doc]);
  const json = useMemo(() => JSON.stringify(definition), [definition]);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(toDefinition(props.initial)));
  const [updatedAt, setUpdatedAt] = useState(props.version.updatedAt);
  const dirty = !ro && json !== savedJson;
  const { onDefinition } = props;
  useEffect(() => {
    onDefinition?.(definition);
  }, [definition, onDefinition]);
  useUnsavedChanges(dirty);

  const [selection, setSelection] = useState<Selection>(NONE);
  const [tab, setTab] = useState<PanelTab>('params');
  const [slotIndex, setSlotIndex] = useState(0);
  const [toast, setToast] = useState<{ tone: 'coral' | 'teal' | 'amber'; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ at: string } | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const { result: check, checking, failed } = useDesignCheck(definition);

  const apply = useCallback(
    (next: DesignerDoc | ((d: DesignerDoc) => DesignerDoc), key?: string) => {
      setHist((h) => commit(h, typeof next === 'function' ? next(h.present) : next, key));
    },
    [],
  );

  // ---- canvas model ---------------------------------------------------------------------------

  const issuesByNode = useMemo(() => {
    const m = new Map<string, { errors: DesignIssue[]; warnings: DesignIssue[] }>();
    for (const i of check?.issues ?? []) {
      if (!i.nodeId) continue;
      const e = m.get(i.nodeId) ?? { errors: [], warnings: [] };
      (i.severity === 'error' ? e.errors : e.warnings).push(i);
      m.set(i.nodeId, e);
    }
    return m;
  }, [check]);

  const built = useMemo((): Node[] => {
    const flowNodes: FlowCardNode[] = doc.nodes.map((n) => {
      const info = check?.nodes[n.id];
      const outputs = outputPortsOf(n.type);
      const firstOut = outputs[0] ? info?.outputs?.[outputs[0].name] : undefined;
      const problems = issuesByNode.get(n.id) ?? { errors: [], warnings: [] };
      const label = n.label || n.id;
      const typeLabel = t(`types.node.${typeKey(n.type)}`);
      return {
        id: n.id,
        type: 'flow',
        position: { x: doc.positions[n.id]?.[0] ?? 0, y: doc.positions[n.id]?.[1] ?? 0 },
        selected: selection.nodes.includes(n.id),
        ariaLabel: [
          t('canvas.nodeAria', { label, type: typeLabel }),
          ...problems.errors.map((e) => e.text),
          ...problems.warnings.map((w) => w.text),
        ].join('. '),
        data: {
          label,
          typeLabel,
          group: groupOf(n.type),
          inputs: inputPortsOf(n.type, n.config),
          outputs,
          columnCount: firstOut ? firstOut.length : null,
          status: !check || (checking && !info) ? 'checking' : (info?.status ?? 'error'),
          errors: problems.errors,
          warnings: problems.warnings,
          readOnly: ro,
        },
      };
    });
    const notes: NoteCardNode[] = doc.notes.map((n) => ({
      id: n.id,
      type: 'note',
      position: { x: n.position[0], y: n.position[1] },
      selected: selection.notes.includes(n.id),
      ariaLabel: t('canvas.noteAria', { text: n.text.slice(0, 80) }),
      data: { text: n.text, placeholder: t('canvas.notePlaceholder') },
    }));
    return [...notes, ...flowNodes];
  }, [doc, check, checking, issuesByNode, selection, ro, t]);

  // React Flow's own node state (measured sizes, positions while dragging) on top of the document.
  const [rfState, setRfState] = useState<Node[]>([]);
  const rfNodes = useMemo(() => mergeRf(built, rfState), [built, rfState]);

  const edges = useMemo(
    (): Edge[] =>
      doc.edges.map((e) => ({
        id: edgeId(e),
        source: e.from,
        sourceHandle: e.fromPort,
        target: e.to,
        targetHandle: e.toPort,
        selected: selection.edges.includes(edgeId(e)),
        ariaLabel: t('canvas.edgeAria', {
          from: e.from,
          fromPort: e.fromPort,
          to: e.to,
          toPort: e.toPort,
        }),
      })),
    [doc.edges, selection.edges, t],
  );

  // React Flow's built-in labels, in Vietnamese.
  const ariaConfig = useMemo(
    () => ({
      'node.a11yDescription.default': t('canvas.aria.node'),
      'node.a11yDescription.keyboardDisabled': t('canvas.aria.nodeNoKeyboard'),
      'node.a11yDescription.ariaLiveMessage': ({
        x,
        y,
      }: {
        direction: string;
        x: number;
        y: number;
      }) => t('canvas.aria.moved', { x: Math.round(x), y: Math.round(y) }),
      'edge.a11yDescription.default': t('canvas.aria.edge'),
      'controls.ariaLabel': t('canvas.aria.controls'),
      'controls.zoomIn.ariaLabel': t('canvas.aria.zoomIn'),
      'controls.zoomOut.ariaLabel': t('canvas.aria.zoomOut'),
      'controls.fitView.ariaLabel': t('canvas.aria.fitView'),
      'controls.interactive.ariaLabel': t('canvas.aria.interactive'),
      'minimap.ariaLabel': t('canvas.minimap'),
      'handle.ariaLabel': t('canvas.aria.handle'),
    }),
    [t],
  );

  const noteIds = useMemo(() => new Set(doc.notes.map((n) => n.id)), [doc.notes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfState((prev) => applyNodeChanges(changes, mergeRf(built, prev)));
      const sel = changes.filter((c) => c.type === 'select');
      if (sel.length > 0) {
        setSelection((s) => {
          const nodes = new Set(s.nodes);
          const notes = new Set(s.notes);
          for (const c of sel) {
            const set = noteIds.has(c.id) ? notes : nodes;
            if (c.selected) set.add(c.id);
            else set.delete(c.id);
          }
          return { ...s, nodes: [...nodes], notes: [...notes] };
        });
      }
    },
    [built, noteIds],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const sel = changes.filter((c) => c.type === 'select');
    if (sel.length === 0) return;
    setSelection((s) => {
      const set = new Set(s.edges);
      for (const c of sel) {
        if (c.selected) set.add(c.id);
        else set.delete(c.id);
      }
      return { ...s, edges: [...set] };
    });
  }, []);

  const onNodeDragStop = useCallback(
    (_e: unknown, _node: Node, nodes: Node[]) => {
      if (ro) return;
      const moves: Record<string, XY> = {};
      for (const n of nodes) moves[n.id] = [n.position.x, n.position.y];
      apply((d) => moveElements(d, moves));
    },
    [apply, ro],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (ro || !c.sourceHandle || !c.targetHandle) return;
      const result = connect(doc, {
        from: c.source,
        fromPort: c.sourceHandle,
        to: c.target,
        toPort: c.targetHandle,
      });
      if (!result.ok) {
        setToast({ tone: 'coral', text: t(`canvas.connect.${result.problem}`) });
        return;
      }
      setToast(null);
      apply(result.doc);
    },
    [apply, doc, ro, t],
  );

  // ---- commands -------------------------------------------------------------------------------

  const texts = useCallback(
    () => ({
      sheetName: t('defaults.sheetName'),
      previewTitle: t('defaults.previewTitle'),
      firstSlot: typeof doc.inputSlots[0]?.key === 'string' ? doc.inputSlots[0].key : undefined,
    }),
    [doc.inputSlots, t],
  );

  const centre = useCallback((): XY => {
    const r = wrapperRef.current?.getBoundingClientRect();
    if (!r) return [80, 80];
    const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    return [p.x - NODE_WIDTH / 2, p.y - 60];
  }, [rf]);

  const addAt = useCallback(
    (type: string, pos: XY) => {
      if (ro) return;
      const r = addNode(doc, type, pos, texts());
      apply(r.doc);
      setSelection({ nodes: [r.id], notes: [], edges: [] });
    },
    [apply, doc, ro, texts],
  );

  const deleteSelection = useCallback(() => {
    if (ro) return;
    apply((d) => removeElements(d, selection));
    setSelection(NONE);
  }, [apply, ro, selection]);

  const copy = useCallback(() => {
    const clip = copySelection(doc, selection.nodes, selection.notes);
    if (clip) {
      clipboard = clip;
      setToast({
        tone: 'teal',
        text: t('canvas.copied', { count: clip.nodes.length + clip.notes.length }),
      });
    }
  }, [doc, selection, t]);

  const pasteClip = useCallback(() => {
    if (ro || !clipboard) return;
    const r = paste(doc, clipboard);
    apply(r.doc);
    setSelection({ nodes: r.nodeIds, notes: r.noteIds, edges: [] });
  }, [apply, doc, ro]);

  const layout = useCallback(() => {
    if (ro) return;
    apply((d) => moveElements(d, autoLayout(d)));
    setTimeout(() => void rf.fitView({ duration: 300 }), 50);
  }, [apply, ro, rf]);

  const addNoteCmd = useCallback(() => {
    if (ro) return;
    const r = addNote(doc, centre());
    apply(r.doc);
    setSelection({ nodes: [], notes: [r.id], edges: [] });
  }, [apply, centre, doc, ro]);

  const exportJson = useCallback(() => {
    const text = JSON.stringify(definition, null, 2);
    saveFile({
      fileName: `${props.flowCode}_v${props.version.versionNo}.json`,
      mimeType: 'application/json',
      data: new TextEncoder().encode(text).buffer,
    });
  }, [definition, props.flowCode, props.version.versionNo]);

  const save = useCallback(async () => {
    if (ro || saving) return;
    setSaving(true);
    const snapshot = json;
    try {
      const next = await api.saveDraft(props.version.id, definition as Json, updatedAt);
      setUpdatedAt(next);
      setSavedJson(snapshot);
      setToast({ tone: 'teal', text: t('save.done') });
    } catch (err) {
      const key = errorKeyOf(err);
      if (key === 'draft_conflict') {
        let at = '';
        try {
          const latest = await api.getFlowVersions(props.flowCode);
          at = latest?.versions.find((v) => v.id === props.version.id)?.updatedAt ?? '';
        } catch {
          // time unknown: the dialog still works
        }
        setConflict({ at });
      } else {
        setToast({ tone: 'coral', text: tc(`admin.errors.${key}`) });
      }
    } finally {
      setSaving(false);
    }
  }, [api, definition, json, props.flowCode, props.version.id, ro, saving, t, tc, updatedAt]);

  const doUndo = useCallback(() => {
    if (!ro) setHist(undo);
  }, [ro]);
  const doRedo = useCallback(() => {
    if (!ro) setHist(redo);
  }, [ro]);

  // Keyboard shortcuts (spec §15.3). Ctrl/Cmd+S never opens the browser's "Save page".
  const keys = useRef({ save, doUndo, doRedo, copy, pasteClip, deleteSelection });
  useEffect(() => {
    keys.current = { save, doUndo, doRedo, copy, pasteClip, deleteSelection };
  });
  const modalOpen = conflict !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') {
        e.preventDefault();
        if (!modalOpen) void keys.current.save();
        return;
      }
      if (modalOpen || document.querySelector('dialog[open]')) return;
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        keys.current.doUndo();
      } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        keys.current.doRedo();
      } else if (!onCanvas(e.target)) {
        // Copy, paste and delete act on the canvas selection only: never while focus is in the
        // config panel, a form control, a dialog or the toolbar.
        return;
      } else if (mod && k === 'c') {
        keys.current.copy();
      } else if (mod && k === 'v') {
        e.preventDefault();
        keys.current.pasteClip();
      } else if ((k === 'delete' || k === 'backspace') && !mod) {
        e.preventDefault();
        keys.current.deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  // In-app navigation with unsaved changes: Rời trang / Ở lại (the tab close prompt comes from
  // useUnsavedChanges; the idle sign-out reloads the page and is never blocked).
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(DRAG_MIME);
    if (!type || ro) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAt(type, [p.x - NODE_WIDTH / 2, p.y - 30]);
  };

  const jump = (issue: DesignIssue) => {
    if (issue.nodeId) {
      setSelection({ nodes: [issue.nodeId], notes: [], edges: [] });
      const p = doc.positions[issue.nodeId];
      if (p)
        void rf.setCenter(p[0] + NODE_WIDTH / 2, p[1] + 80, { zoom: rf.getZoom(), duration: 300 });
    } else if (issue.slotIndex !== undefined) {
      setSelection(NONE);
      setTab('slots');
      setSlotIndex(issue.slotIndex);
    } else if (issue.paramIndex !== undefined) {
      setSelection(NONE);
      setTab('params');
    }
  };

  const selectedNode =
    selection.nodes.length === 1 && selection.notes.length === 0
      ? (doc.nodes.find((n) => n.id === selection.nodes[0]) ?? null)
      : null;
  const selectedNote =
    selection.notes.length === 1 && selection.nodes.length === 0
      ? (doc.notes.find((n) => n.id === selection.notes[0]) ?? null)
      : null;
  const hasSelection = selection.nodes.length + selection.notes.length + selection.edges.length > 0;
  const toolButton = 'min-h-target px-3 text-small';

  return (
    <div className="hr-designer flex h-[calc(100dvh-64px)] min-h-150 flex-col">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line bg-card px-3.5 py-2">
        <Link
          to="/admin/flows/$flowCode/versions"
          params={{ flowCode: props.flowCode }}
          className="min-h-target content-center rounded-control px-2.5 text-small font-semibold text-teal-strong no-underline hover:bg-page"
        >
          {t('toolbar.back')}
        </Link>
        <h1 className="m-0 flex items-center gap-2 text-section text-ink">
          <span className="truncate">{props.flowName}</span>
          <span className="text-label text-muted">v{props.version.versionNo}</span>
          <Chip tone={VERSION_STATUS_TONE[props.version.status]}>
            {tc(`admin.flows.status.${props.version.status}`)}
          </Chip>
        </h1>
        {!ro && (
          <span
            role="status"
            className={cx(
              'text-small font-semibold',
              dirty ? 'text-amber-text' : 'text-teal-strong',
            )}
          >
            {dirty ? t('save.dirty') : t('save.clean')}
          </span>
        )}
        <div
          role="toolbar"
          aria-label={t('toolbar.label')}
          className="ml-auto flex flex-wrap items-center gap-1.5"
        >
          {!ro && (
            <>
              <Button
                className={toolButton}
                onClick={doUndo}
                disabled={hist.past.length === 0}
                aria-keyshortcuts="Control+Z"
              >
                {t('toolbar.undo')}
              </Button>
              <Button
                className={toolButton}
                onClick={doRedo}
                disabled={hist.future.length === 0}
                aria-keyshortcuts="Control+Shift+Z Control+Y"
              >
                {t('toolbar.redo')}
              </Button>
            </>
          )}
          <Button
            className={toolButton}
            onClick={copy}
            disabled={selection.nodes.length + selection.notes.length === 0}
            aria-keyshortcuts="Control+C"
          >
            {t('toolbar.copy')}
          </Button>
          {!ro && (
            <>
              <Button className={toolButton} onClick={pasteClip} aria-keyshortcuts="Control+V">
                {t('toolbar.paste')}
              </Button>
              <Button
                className={toolButton}
                onClick={deleteSelection}
                disabled={!hasSelection}
                aria-keyshortcuts="Delete"
              >
                {t('toolbar.delete')}
              </Button>
              <Button className={toolButton} onClick={addNoteCmd}>
                {t('toolbar.note')}
              </Button>
              <Button className={toolButton} onClick={layout} disabled={doc.nodes.length === 0}>
                {t('toolbar.layout')}
              </Button>
            </>
          )}
          <Button className={toolButton} onClick={exportJson}>
            {t('toolbar.export')}
          </Button>
          {!ro && (
            <Button
              variant="primary"
              className={toolButton}
              onClick={() => void save()}
              disabled={saving}
              aria-keyshortcuts="Control+S"
            >
              {saving ? t('save.saving') : t('save.button')}
            </Button>
          )}
        </div>
      </header>

      {ro && (
        <div className="border-b border-line bg-card px-3.5 py-2">
          <Callout tone="blue" label={t('readOnly.label')} role="status">
            {t('readOnly.text')}{' '}
            <Button
              className="ml-2 min-h-target px-3 text-small"
              onClick={props.onCreateDraft}
              disabled={props.creatingDraft}
            >
              {tc('admin.versions.clone')}
            </Button>
          </Callout>
        </div>
      )}
      {toast && (
        <div className="border-b border-line bg-card px-3.5 py-1.5">
          <Callout
            tone={toast.tone}
            label={
              toast.tone === 'coral'
                ? t('toast.errorLabel')
                : toast.tone === 'amber'
                  ? t('toast.noteLabel')
                  : t('toast.okLabel')
            }
            role={toast.tone === 'coral' ? 'alert' : 'status'}
          >
            {toast.text}
          </Callout>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {!ro && (
          <aside className="w-62 shrink-0 border-r border-line bg-card">
            <Palette onAdd={(type) => addAt(type, centre())} disabled={ro} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={wrapperRef}
            className="relative min-h-0 flex-1"
            onDragOver={onDragOver}
            onDrop={onDrop}
            aria-label={t('canvas.label')}
            role="region"
          >
            <ReactFlow
              nodes={rfNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              onPaneClick={() => setSelection(NONE)}
              nodesDraggable={!ro}
              nodesConnectable={!ro}
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
              minZoom={0.2}
              maxZoom={2}
              ariaLabelConfig={ariaConfig}
            >
              <Background gap={20} />
              <MiniMap pannable zoomable ariaLabel={t('canvas.minimap')} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {doc.nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="m-0 max-w-90 rounded-tile bg-card px-5 py-4 text-center text-label text-muted shadow-soft">
                  {ro ? t('canvas.emptyReadOnly') : t('canvas.empty')}
                </p>
              </div>
            )}
          </div>
          <section
            aria-labelledby="designer-data-title"
            role="region"
            className="border-t border-line bg-card"
          >
            <h2 id="designer-data-title" className="m-0">
              <button
                type="button"
                aria-expanded={dataOpen}
                onClick={() => setDataOpen((o) => !o)}
                className="flex min-h-target w-full items-center px-3.5 text-left text-label font-bold text-ink hover:bg-page"
              >
                {t('data.title')}
              </button>
            </h2>
            <div hidden={!dataOpen}>
              <DataPanel doc={doc} definition={definition} node={selectedNode} />
            </div>
          </section>
          <StatusBar check={check} checking={checking} failed={failed} onJump={jump} />
        </div>
        <aside
          aria-label={t('panel.label')}
          className="w-105 shrink-0 overflow-y-auto border-l border-line bg-card p-4"
        >
          <ConfigPanel
            doc={doc}
            node={selectedNode}
            note={selectedNote}
            check={check}
            readOnly={ro}
            tab={tab}
            onTab={setTab}
            slotIndex={slotIndex}
            onSlotIndex={setSlotIndex}
            onNodeConfig={(id, config, mk, renames) =>
              apply((d) => updateNode(d, id, { config }, renames), mk)
            }
            onNodeLabel={(id, label) => apply((d) => updateNode(d, id, { label }), `${id}:label`)}
            onParams={(params, mk) => apply((d) => ({ ...d, params }), mk)}
            onSlots={(inputSlots, mk) => apply((d) => ({ ...d, inputSlots }), mk)}
            onNote={(id, text) => apply((d) => updateNote(d, id, text), `${id}:text`)}
            onDeleteSelection={deleteSelection}
          />
        </aside>
      </div>

      <Dialog
        open={blocker.status === 'blocked'}
        onClose={() => blocker.reset?.()}
        title={t('leave.title')}
      >
        <p className="m-0 text-copy text-body">{t('leave.text')}</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={() => blocker.reset?.()}>{t('leave.stay')}</Button>
          <Button variant="primary" onClick={() => blocker.proceed?.()}>
            {t('leave.leave')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title={t('conflict.title')}
      >
        <p className="m-0 text-copy text-body">
          {conflict?.at
            ? t('conflict.text', { time: formatTime(conflict.at) })
            : t('conflict.textNoTime')}
        </p>
        <p className="m-0 text-small text-muted">{t('conflict.hint')}</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={exportJson}>{t('conflict.export')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              setConflict(null);
              props.onReload();
            }}
          >
            {t('conflict.reload')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

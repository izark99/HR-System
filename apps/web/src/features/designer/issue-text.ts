import type { DesignIssue } from '../../engine/design';

/**
 * Text of a design-check issue for people (MEMORY 2026-11-06 18:27): the config path of an
 * invalid field (`on.0.left`) is said with the field labels of the node form ("Cột khóa, dòng 1,
 * Cột bảng trái"), never as the internal key. Inside the node's own panel the node name is left
 * out (the panel title already says it); the status bar and the node tooltip keep it.
 * The validation itself is unchanged: only the wording of `executor.error.invalidConfig` and of the
 * "Node \"…\": " prefix differs.
 */

/** The `t` of i18next, as far as this file needs it. */
type TFunction = (key: string, options?: Record<string, unknown>) => string;

/** Form namespace (`designer:node.<ns>`) of each node type. */
const FORM_NS: Record<string, string> = {
  'input.excel': 'inputExcel',
  'input.refTable': 'refTable',
  'control.compare': 'compare',
  'output.excel': 'outputExcel',
  'output.preview': 'preview',
  'transform.select': 'select',
  'transform.filter': 'filter',
  'transform.sort': 'sort',
  'transform.join': 'join',
  'transform.union': 'union',
  'transform.groupBy': 'groupBy',
  'transform.dedupe': 'dedupe',
  'code.sql': 'sql',
  'transform.formula': 'formula',
};

/**
 * Config key → label key in the node's form namespace. A `parent.key` entry wins over `key` (the
 * same key can mean different fields, e.g. `left` of a metric and of the side names). Keys left
 * out read as the label of the same name (`keys` → `node.compare.keys`); a unit test checks that
 * every key of every config schema gets a label.
 */
const LABELS: Record<string, Record<string, string>> = {
  compare: {
    label: 'metricLabel',
    carryColumns: 'carry',
    'sideLabels.left': 'sideLeft',
    'sideLabels.right': 'sideRight',
  },
  select: { title: 'titleField' },
  filter: { param: 'paramField' },
  union: { missingColumns: 'missing', sourceColumn: 'source', key: 'sourceKey' },
  groupBy: { title: 'titleField' },
  outputExcel: { name: 'sheetName' },
};

/**
 * "Cột khóa, dòng 1, Cột bảng trái" for `on.0.left` of a join. `short`: only the last field (and
 * its row), for a message shown at the field itself ("Cột bảng trái"; `keys.0` → "Cột khóa, dòng 1").
 */
export function issueFieldLabel(
  t: TFunction,
  nodeType: string,
  path: string,
  short = false,
): string {
  const ns = FORM_NS[nodeType];
  const parts: string[] = [];
  let parent = '';
  for (const seg of path.split('.')) {
    if (/^\d+$/.test(seg)) {
      parts.push(t('designer:panel.issuePath.row', { n: Number(seg) + 1 }));
      continue;
    }
    const own = ns ? (LABELS[ns]?.[`${parent}.${seg}`] ?? LABELS[ns]?.[seg] ?? seg) : '';
    const label = own ? t(`designer:node.${ns}.${own}`, { defaultValue: '' }) : '';
    const shared = t(`designer:panel.issuePath.keys.${seg}`, { defaultValue: '' });
    parts.push(label || shared || t('designer:panel.issuePath.other'));
    parent = seg;
  }
  if (short) {
    const segs = path.split('.');
    const last = segs.findLastIndex((x) => !/^\d+$/.test(x));
    if (last >= 0) return parts.slice(last).join(', ');
  }
  return parts.join(', ');
}

/** Removes the node name from an engine message (in the node's own panel). */
export function withoutNode(t: TFunction, text: string, node: string): string {
  const prefixes = [`Node "${node}": `, `Node "${node}", `];
  for (const p of prefixes)
    if (text.startsWith(p)) {
      const rest = text.slice(p.length);
      return rest.charAt(0).toLocaleUpperCase('vi') + rest.slice(1);
    }
  return text
    .split(`node "${node}"`)
    .join(t('designer:panel.issuePath.thisNode'))
    .split(`Node "${node}"`)
    .join(t('designer:panel.issuePath.thisNodeStart'));
}

/**
 * Text of an issue. `inPanel`: shown in the node's own config panel (no node name). Issues that
 * are not about a node come back as the engine text.
 */
export function issueText(
  t: TFunction,
  issue: DesignIssue,
  nodeType: string | undefined,
  inPanel: boolean,
): string {
  if (issue.nodeId === undefined || nodeType === undefined) return issue.text;
  const node = typeof issue.params.node === 'string' ? issue.params.node : '';
  if (issue.messageKey === 'executor.error.invalidConfig' && issue.path !== undefined) {
    // In the panel the message sits right under its field, whose label is just above: no label.
    if (inPanel) return t('designer:panel.issuePath.invalidHere');
    const field = issueFieldLabel(t, nodeType, issue.path, inPanel);
    return t('designer:panel.issuePath.invalidNode', { node, field });
  }
  return inPanel && node ? withoutNode(t, issue.text, node) : issue.text;
}

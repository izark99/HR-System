/**
 * Node types of the Designer palette (spec §12, §15.3): group, ports and the config a new node
 * starts with. Ports mirror the engine plugins (`engine/nodes/*`, checked by a unit test) without
 * importing them: the engine stays in the worker chunk.
 */

export type NodeGroup = 'input' | 'transform' | 'control' | 'code' | 'output';

export const NODE_GROUPS: NodeGroup[] = ['input', 'transform', 'control', 'code', 'output'];

export interface PortSpec {
  name: string;
  required: boolean;
}

export interface NodeTypeSpec {
  type: string;
  group: NodeGroup;
  /** Prefix of generated node ids (snake_case). */
  idPrefix: string;
  inputs(config: Record<string, unknown>): PortSpec[];
  outputs: PortSpec[];
  /** Config of a new node; `text` gives localized default texts (sheet name, tab title). */
  defaults(text: DefaultTexts): Record<string, unknown>;
}

export interface DefaultTexts {
  sheetName: string;
  previewTitle: string;
  firstSlot: string | undefined;
}

const one = (name: string, required = true): PortSpec[] => [{ name, required }];
const OUT = one('out', false);

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function portNames(list: unknown, field: 'port'): PortSpec[] {
  const names: string[] = [];
  for (const item of arr(list)) {
    const n = (item as Record<string, unknown> | null)?.[field];
    if (typeof n === 'string' && n && !names.includes(n)) names.push(n);
  }
  return names.map((name) => ({ name, required: true }));
}

export const NODE_TYPES: NodeTypeSpec[] = [
  {
    type: 'input.excel',
    group: 'input',
    idPrefix: 'input',
    inputs: () => [],
    outputs: one('table', false),
    defaults: (t) => ({ slot: t.firstSlot ?? '' }),
  },
  {
    type: 'transform.select',
    group: 'transform',
    idPrefix: 'select',
    inputs: () => one('in'),
    outputs: OUT,
    defaults: () => ({ columns: [] }),
  },
  {
    type: 'transform.filter',
    group: 'transform',
    idPrefix: 'filter',
    inputs: () => one('in'),
    outputs: OUT,
    defaults: () => ({ match: 'all', conditions: [], normalizeText: true }),
  },
  {
    type: 'transform.formula',
    group: 'transform',
    idPrefix: 'formula',
    inputs: () => one('in'),
    outputs: OUT,
    defaults: () => ({ columns: [] }),
  },
  {
    type: 'transform.sort',
    group: 'transform',
    idPrefix: 'sort',
    inputs: () => one('in'),
    outputs: OUT,
    defaults: () => ({ by: [] }),
  },
  {
    type: 'transform.join',
    group: 'transform',
    idPrefix: 'join',
    inputs: () => [
      { name: 'left', required: true },
      { name: 'right', required: true },
    ],
    outputs: OUT,
    defaults: () => ({ how: 'inner', on: [], normalizeKeys: true, rightSuffix: '_r' }),
  },
  {
    type: 'transform.union',
    group: 'transform',
    idPrefix: 'union',
    inputs: (c) => {
      const n = typeof c.inputCount === 'number' ? c.inputCount : 2;
      const count = Number.isInteger(n) && n >= 2 && n <= 10 ? n : 2;
      return Array.from({ length: count }, (_, i) => ({ name: `in_${i + 1}`, required: true }));
    },
    outputs: OUT,
    defaults: () => ({ inputCount: 2, missingColumns: 'null' }),
  },
  {
    type: 'transform.groupBy',
    group: 'transform',
    idPrefix: 'group_by',
    inputs: () => one('in'),
    outputs: OUT,
    defaults: () => ({ by: [], aggregations: [] }),
  },
  {
    type: 'transform.dedupe',
    group: 'transform',
    idPrefix: 'dedupe',
    inputs: () => one('in'),
    outputs: [
      { name: 'out', required: false },
      { name: 'removed', required: false },
    ],
    defaults: () => ({ keys: [], keep: 'first', normalizeKeys: true }),
  },
  {
    type: 'control.compare',
    group: 'control',
    idPrefix: 'compare',
    inputs: () => [
      { name: 'left', required: true },
      { name: 'right', required: true },
    ],
    outputs: [
      { name: 'summary', required: false },
      { name: 'mismatched', required: false },
      { name: 'only_left', required: false },
      { name: 'only_right', required: false },
    ],
    defaults: () => ({ keys: [], metrics: [], carryColumns: [], nullAsZero: true }),
  },
  {
    type: 'code.sql',
    group: 'code',
    idPrefix: 'sql',
    inputs: (c) => portNames(c.inputs, 'port'),
    outputs: OUT,
    defaults: () => ({ inputs: [{ port: 'bang_1' }], sql: 'SELECT *\nFROM bang_1' }),
  },
  {
    type: 'output.excel',
    group: 'output',
    idPrefix: 'excel',
    inputs: (c) => portNames(c.sheets, 'port'),
    outputs: [],
    defaults: (t) => ({
      fileName: 'KetQua.xlsx',
      sheets: [{ name: t.sheetName, port: 'sheet_1' }],
    }),
  },
  {
    type: 'output.preview',
    group: 'output',
    idPrefix: 'preview',
    inputs: () => one('in'),
    outputs: [],
    defaults: (t) => ({ title: t.previewTitle, maxRows: 100_000 }),
  },
];

const BY_TYPE = new Map(NODE_TYPES.map((s) => [s.type, s]));

export function nodeSpec(type: string): NodeTypeSpec | undefined {
  return BY_TYPE.get(type);
}

export function inputPortsOf(type: string, config: Record<string, unknown>): PortSpec[] {
  return nodeSpec(type)?.inputs(config) ?? [];
}

export function outputPortsOf(type: string): PortSpec[] {
  return nodeSpec(type)?.outputs ?? [];
}

export function groupOf(type: string): NodeGroup {
  return nodeSpec(type)?.group ?? 'transform';
}

/** i18n key segment of a node type (i18next splits keys on "."). */
export function typeKey(type: string): string {
  return type.replace(/\./g, '_');
}

import { describe, expect, it } from 'vitest';
import { CompareConfigSchema, FlowDefinitionSchema, InputSlotSchema } from './index';

describe('InputSlotSchema', () => {
  it('applies defaults', () => {
    const slot = InputSlotSchema.parse({
      key: 'bang_luong',
      label: 'Bảng lương',
      columns: [{ key: 'ma_nv', aliases: ['Mã NV'], type: 'string' }],
    });
    expect(slot.headerRow).toBe(1);
    expect(slot.multiple).toEqual({ enabled: false, minFiles: 1, maxFiles: 50 });
    expect(slot.columns[0]?.required).toBe(false);
    expect(slot.extraColumns).toBe('drop');
  });

  it('rejects skipRows on an unknown column and duplicate column keys', () => {
    const r = InputSlotSchema.safeParse({
      key: 's',
      label: 'S',
      skipRows: { whenBlank: ['nope'] },
      columns: [
        { key: 'a', aliases: ['A'], type: 'string' },
        { key: 'a', aliases: ['B'], type: 'string' },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('SlotColumnSchema: presence vs required (spec §10)', () => {
  const parseCol = (c: Record<string, unknown>) =>
    InputSlotSchema.safeParse({
      key: 's',
      label: 'S',
      columns: [{ key: 'c', aliases: ['C'], type: 'decimal', ...c }],
    });
  const col = (c: Record<string, unknown>) => {
    const r = parseCol(c);
    if (!r.success) throw new Error(r.error.message);
    return r.data.columns[0]!;
  };

  it('presence defaults follow required (backward compatible)', () => {
    expect(col({})).toMatchObject({ presence: 'optional', required: false });
    expect(col({ required: true })).toMatchObject({ presence: 'required', required: true });
    expect(col({ presence: 'required' })).toMatchObject({ presence: 'required', required: false });
    expect(col({ presence: 'optional', required: true })).toMatchObject({
      presence: 'optional',
      required: true,
    });
  });

  it('defaultValue must fit the column type and is not allowed with required: true', () => {
    expect(col({ presence: 'required', defaultValue: 0 }).defaultValue).toBe(0);
    expect(parseCol({ defaultValue: '0.5' }).success).toBe(true);
    expect(parseCol({ defaultValue: 'abc' }).success).toBe(false);
    expect(parseCol({ defaultValue: true }).success).toBe(false);
    expect(parseCol({ required: true, defaultValue: 0 }).success).toBe(false);
    expect(parseCol({ type: 'integer', defaultValue: 1.5 }).success).toBe(false);
    expect(parseCol({ type: 'string', defaultValue: 'N/A' }).success).toBe(true);
    expect(parseCol({ type: 'date', defaultValue: '2026-09-01' }).success).toBe(true);
    expect(parseCol({ type: 'date', defaultValue: '01/09/2026' }).success).toBe(false);
  });
});

describe('FlowDefinitionSchema', () => {
  const base = {
    schemaVersion: 1,
    nodes: [
      { id: 'a', type: 'input.excel' },
      { id: 'b', type: 'control.compare' },
    ],
  };

  it('accepts a DAG', () => {
    expect(
      FlowDefinitionSchema.safeParse({ ...base, edges: [{ from: 'a', to: 'b' }] }).success,
    ).toBe(true);
  });

  it('rejects cycles and dangling edges', () => {
    const cyclic = {
      ...base,
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    expect(FlowDefinitionSchema.safeParse(cyclic).success).toBe(false);
    expect(
      FlowDefinitionSchema.safeParse({ ...base, edges: [{ from: 'a', to: 'zz' }] }).success,
    ).toBe(false);
  });
});

describe('CompareConfigSchema', () => {
  it('defaults nullAsZero to true and tolerance to 0', () => {
    const cfg = CompareConfigSchema.parse({
      keys: ['ma_nv'],
      metrics: [{ left: 'cong', right: 'cong', label: 'Công' }],
    });
    expect(cfg.nullAsZero).toBe(true);
    expect(cfg.metrics[0]?.tolerance).toBe('0');
  });

  it('rejects a non-decimal tolerance string', () => {
    const r = CompareConfigSchema.safeParse({
      keys: ['ma_nv'],
      metrics: [{ left: 'x', right: 'x', label: 'X', tolerance: '0,5' }],
    });
    expect(r.success).toBe(false);
  });
});

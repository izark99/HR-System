import { describe, expect, it } from 'vitest';
import { FlowDefinitionSchema, migrateFlowDefinition } from './index';

const slot = (key: string, accept?: string[]) => ({
  key,
  label: key,
  columns: [{ key: 'ma_nv', aliases: ['Mã NV'], type: 'string' }],
  ...(accept ? { accept } : {}),
});

const flow = (slots: unknown[]) => ({
  schemaVersion: 1,
  nodes: [{ id: 'in_a', type: 'input.excel', config: { slot: 'a' } }],
  inputSlots: slots,
});

describe('migrateFlowDefinition (published versions stay loadable, spec §8)', () => {
  it('strips .csv from accept with a note; the result parses', () => {
    const raw = flow([slot('a', ['.xlsx', '.CSV ', '.xls']), slot('b', ['.xlsx'])]);
    const { definition, notes } = migrateFlowDefinition(raw);
    expect(notes).toEqual([{ code: 'acceptCsvRemoved', slot: 'a' }]);
    const parsed = FlowDefinitionSchema.parse(definition);
    expect(parsed.inputSlots.map((s) => s.accept)).toEqual([['.xlsx', '.xls'], ['.xlsx']]);
    // Old definitions without the step would be rejected outright.
    expect(FlowDefinitionSchema.safeParse(raw).success).toBe(false);
  });

  it('a slot that accepted only .csv falls back to the default accept list', () => {
    const { definition, notes } = migrateFlowDefinition(flow([slot('a', ['.csv'])]));
    expect(notes).toEqual([{ code: 'acceptCsvOnlyReplaced', slot: 'a' }]);
    expect(FlowDefinitionSchema.parse(definition).inputSlots[0]!.accept).toEqual(['.xlsx', '.xls']);
  });

  it('does not mutate the input and returns the same object when nothing changes', () => {
    const raw = flow([slot('a', ['.xlsx', '.csv'])]);
    const before = JSON.stringify(raw);
    migrateFlowDefinition(raw);
    expect(JSON.stringify(raw)).toBe(before);
    const clean = flow([slot('a', ['.xlsx'])]);
    expect(migrateFlowDefinition(clean)).toEqual({ definition: clean, notes: [] });
    expect(migrateFlowDefinition(clean).definition).toBe(clean);
  });

  it('ignores non-object input (left to the schema to reject)', () => {
    expect(migrateFlowDefinition(null)).toEqual({ definition: null, notes: [] });
    expect(migrateFlowDefinition({ inputSlots: 'x' }).notes).toEqual([]);
    expect(migrateFlowDefinition(flow([42, { accept: ['.csv'] }])).notes).toEqual([
      { code: 'acceptCsvOnlyReplaced', slot: '1' },
    ]);
  });
});

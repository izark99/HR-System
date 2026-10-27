import { describe, expect, it } from 'vitest';
import {
  CodeSqlConfigSchema,
  DedupeConfigSchema,
  FilterConfigSchema,
  GroupByConfigSchema,
  JoinConfigSchema,
  OutputPreviewConfigSchema,
  SelectConfigSchema,
  SortConfigSchema,
  UnionConfigSchema,
} from './index';

/** Step-3 node configs (spec §12.1): shapes and defaults. */

describe('step-3 node config schemas', () => {
  it('select: at least one column; key must be an identifier', () => {
    expect(SelectConfigSchema.safeParse({ columns: [] }).success).toBe(false);
    expect(SelectConfigSchema.safeParse({ columns: [{ from: 'a', key: 'Bad Key' }] }).success).toBe(
      false,
    );
    expect(SelectConfigSchema.parse({ columns: [{ from: 'a' }] })).toEqual({
      columns: [{ from: 'a' }],
    });
  });

  it('filter: defaults match=all, normalizeText=true; value/values required by op', () => {
    expect(FilterConfigSchema.parse({ conditions: [{ column: 'a', op: 'isBlank' }] })).toEqual({
      match: 'all',
      normalizeText: true,
      conditions: [{ column: 'a', op: 'isBlank' }],
    });
    expect(FilterConfigSchema.safeParse({ conditions: [{ column: 'a', op: 'eq' }] }).success).toBe(
      false,
    );
    expect(FilterConfigSchema.safeParse({ conditions: [{ column: 'a', op: 'in' }] }).success).toBe(
      false,
    );
    expect(
      FilterConfigSchema.safeParse({
        conditions: [{ column: 'a', op: 'in', values: Array.from({ length: 501 }, () => 'x') }],
      }).success,
    ).toBe(false);
    expect(
      FilterConfigSchema.safeParse({
        conditions: [{ column: 'a', op: 'eq', value: { param: 'ky_luong' } }],
      }).success,
    ).toBe(true);
    expect(FilterConfigSchema.safeParse({ conditions: [] }).success).toBe(false);
  });

  it('sort: direction asc, blanks last by default', () => {
    expect(SortConfigSchema.parse({ by: [{ column: 'a' }] }).by[0]).toEqual({
      column: 'a',
      direction: 'asc',
      blanks: 'last',
    });
  });

  it('join: normalizeKeys true and rightSuffix "_r" by default; suffix pattern checked', () => {
    const j = JoinConfigSchema.parse({ how: 'left', on: [{ left: 'a', right: 'b' }] });
    expect(j.normalizeKeys).toBe(true);
    expect(j.rightSuffix).toBe('_r');
    expect(
      JoinConfigSchema.safeParse({ how: 'left', on: [{ left: 'a', right: 'b' }], rightSuffix: 'r' })
        .success,
    ).toBe(false);
    expect(
      JoinConfigSchema.safeParse({ how: 'cross', on: [{ left: 'a', right: 'b' }] }).success,
    ).toBe(false);
  });

  it('union: 2..10 inputs; sourceColumn needs one label per input', () => {
    expect(UnionConfigSchema.parse({})).toEqual({ inputCount: 2, missingColumns: 'null' });
    expect(UnionConfigSchema.safeParse({ inputCount: 11 }).success).toBe(false);
    expect(
      UnionConfigSchema.safeParse({
        inputCount: 3,
        sourceColumn: { key: 'nguon', labels: ['a', 'b'] },
      }).success,
    ).toBe(false);
  });

  it('groupBy: column required except for countRows; by defaults to []', () => {
    expect(GroupByConfigSchema.parse({ aggregations: [{ key: 'n', fn: 'countRows' }] }).by).toEqual(
      [],
    );
    expect(GroupByConfigSchema.safeParse({ aggregations: [{ key: 's', fn: 'sum' }] }).success).toBe(
      false,
    );
  });

  it('dedupe: keep first, normalizeKeys true', () => {
    expect(DedupeConfigSchema.parse({ keys: ['a'] })).toEqual({
      keys: ['a'],
      keep: 'first',
      normalizeKeys: true,
    });
  });

  it('code.sql: 1..10 unique ports, SQL 1..100000 chars', () => {
    expect(CodeSqlConfigSchema.safeParse({ inputs: [], sql: 'SELECT 1' }).success).toBe(false);
    expect(
      CodeSqlConfigSchema.safeParse({ inputs: [{ port: 'a' }, { port: 'a' }], sql: 'SELECT 1' })
        .success,
    ).toBe(false);
    expect(
      CodeSqlConfigSchema.safeParse({ inputs: [{ port: 'a' }], sql: 'x'.repeat(100_001) }).success,
    ).toBe(false);
  });

  it('output.preview: title 1..60, maxRows 1..1,000,000 (default 100,000)', () => {
    expect(OutputPreviewConfigSchema.parse({ title: 'Theo chi nhánh' }).maxRows).toBe(100_000);
    expect(OutputPreviewConfigSchema.safeParse({ title: '' }).success).toBe(false);
    expect(OutputPreviewConfigSchema.safeParse({ title: 'x'.repeat(61) }).success).toBe(false);
    expect(OutputPreviewConfigSchema.safeParse({ title: 'x', maxRows: 1_000_001 }).success).toBe(
      false,
    );
  });
});

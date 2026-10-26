import { FlowDefinitionSchema } from '@hrflow/flow-schema';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SlotValidation } from '../../../engine/protocol';
import { readiness } from '../readiness';
import type { SessionState, SlotState } from '../run-store';

const FIXTURES = resolve(import.meta.dirname, '../../../../../../fixtures/payroll-timesheet');
const flow = FlowDefinitionSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')),
);

const file = (name: string) => ({ id: 1, file: new File(['x'], name) });

function validation(errors: number, warnings: number, skipped = 0): SlotValidation {
  return {
    slotKey: 's',
    rowCount: 1,
    report: {
      issues: [],
      errorCount: errors,
      warningCount: warnings,
      skippedRows: Array.from({ length: skipped }, () => ({})),
      files: [],
    } as unknown as SlotValidation['report'],
  };
}

function slot(p: Partial<SlotState> = {}): SlotState {
  return {
    files: [file('a.xlsx')],
    validating: false,
    validation: validation(0, 0),
    failed: false,
    ...p,
  };
}

function state(p: Partial<SessionState> = {}): SessionState {
  return {
    code: 'payroll-timesheet',
    load: 'ready',
    problems: [],
    summary: null,
    flow,
    params: { ky_luong: '2026-09' },
    slots: { bang_luong: slot(), cham_cong: slot() },
    run: { status: 'idle', nodes: [], error: null, summary: null, params: {} },
    restoring: false,
    restoreFailed: false,
    asOf: '2026-09-01',
    version: null,
    versionCheck: 'ok',
    ...p,
  };
}

describe('readiness (Run button rules, spec §15.1 step 4)', () => {
  it('a failed restore after a hard cancel blocks running', () => {
    expect(readiness(state({ restoreFailed: true })).canRun).toBe(false);
  });

  it('no usable version for the as-of date blocks running (spec §14.2)', () => {
    for (const versionCheck of ['resolving', 'none', 'error'] as const) {
      expect(readiness(state({ versionCheck }))).toMatchObject({
        canRun: false,
        versionBlocked: true,
      });
    }
  });

  it('all good → canRun', () => {
    expect(readiness(state())).toMatchObject({ canRun: true, errors: 0, warnings: 0 });
  });

  it('warnings only still allow running; skipped rows are summed', () => {
    const r = readiness(
      state({
        slots: { bang_luong: slot({ validation: validation(0, 2, 3) }), cham_cong: slot() },
      }),
    );
    expect(r).toMatchObject({ canRun: true, warnings: 2, skipped: 3 });
  });

  it('any error blocks; errors are summed across slots', () => {
    const r = readiness(
      state({
        slots: {
          bang_luong: slot({ validation: validation(2, 0) }),
          cham_cong: slot({ validation: validation(1, 0) }),
        },
      }),
    );
    expect(r).toMatchObject({ canRun: false, errors: 3 });
  });

  it('a slot that failed to read counts as one error', () => {
    const r = readiness(
      state({ slots: { bang_luong: slot({ failed: true, validation: null }), cham_cong: slot() } }),
    );
    expect(r).toMatchObject({ canRun: false, errors: 1, validating: false });
  });

  it('missing required slot and blank/whitespace param are reported', () => {
    const r = readiness(
      state({
        params: { ky_luong: '   ' },
        slots: { bang_luong: slot({ files: [] }), cham_cong: slot() },
      }),
    );
    expect(r).toMatchObject({
      canRun: false,
      missingSlots: ['bang_luong'],
      missingParams: ['ky_luong'],
    });
  });

  it('validating, not-yet-validated, restoring and non-ready load all block', () => {
    expect(
      readiness(state({ slots: { bang_luong: slot({ validating: true }), cham_cong: slot() } }))
        .canRun,
    ).toBe(false);
    const pending = readiness(
      state({ slots: { bang_luong: slot({ validation: null }), cham_cong: slot() } }),
    );
    expect(pending).toMatchObject({ canRun: false, validating: true });
    expect(readiness(state({ restoring: true })).canRun).toBe(false);
    expect(readiness(state({ load: 'loading' })).canRun).toBe(false);
  });

  it('a slot with no files ignores its stale validation', () => {
    const r = readiness(
      state({
        slots: { bang_luong: slot({ files: [], validation: validation(5, 5) }), cham_cong: slot() },
      }),
    );
    expect(r).toMatchObject({ errors: 0, warnings: 0, missingSlots: ['bang_luong'] });
  });
});

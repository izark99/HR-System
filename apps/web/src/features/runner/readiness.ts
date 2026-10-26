import type { SessionState } from './run-store';

export interface Readiness {
  errors: number;
  warnings: number;
  skipped: number;
  validating: boolean;
  missingSlots: string[];
  missingParams: string[];
  canRun: boolean;
}

/** Whether the Run button is enabled, and why not (spec §15.1 step 4). */
export function readiness(state: SessionState): Readiness {
  const flow = state.flow;
  let errors = 0;
  let warnings = 0;
  let skipped = 0;
  let validating = false;
  const missingSlots: string[] = [];
  for (const slot of flow?.inputSlots ?? []) {
    const s = state.slots[slot.key];
    if (!s) continue;
    if (s.validating) validating = true;
    if (s.files.length === 0) {
      if (slot.required) missingSlots.push(slot.key);
      continue;
    }
    if (s.failed) errors++;
    const report = s.validation?.report;
    if (report) {
      errors += report.errorCount;
      warnings += report.warningCount;
      skipped += report.skippedRows.length;
    } else if (!s.validating && !s.failed) {
      validating = true;
    }
  }
  const missingParams = (flow?.params ?? [])
    .filter((p) => {
      const v = state.params[p.key];
      return p.required && (v === null || v === undefined || String(v).trim() === '');
    })
    .map((p) => p.key);
  return {
    errors,
    warnings,
    skipped,
    validating,
    missingSlots,
    missingParams,
    canRun:
      state.load === 'ready' &&
      !state.restoring &&
      !state.restoreFailed &&
      !validating &&
      errors === 0 &&
      missingSlots.length === 0 &&
      missingParams.length === 0,
  };
}

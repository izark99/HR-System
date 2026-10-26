/**
 * Schema compatibility (spec §8): a PUBLISHED flow version is immutable and must stay loadable by
 * every later app release. A schema change is therefore either additive, or comes with a
 * preprocess step here that rewrites old definitions in memory (never in the database) before
 * `FlowDefinitionSchema` parses them, and reports what it changed.
 *
 * Steps:
 * - `.csv` was removed from `inputSlots[].accept` (MEMORY 2026-10-26 13:08): it is stripped; a
 *   slot that accepted only `.csv` falls back to the default (.xlsx, .xls).
 */

export type FlowMigrationCode = 'acceptCsvRemoved' | 'acceptCsvOnlyReplaced';

export interface FlowMigrationNote {
  code: FlowMigrationCode;
  /** Slot key (or index when the key is missing) the note is about. */
  slot: string;
}

export interface FlowMigrationResult {
  /** The (possibly rewritten) raw definition; the input object is never mutated. */
  definition: unknown;
  notes: FlowMigrationNote[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function migrateSlot(slot: unknown, index: number, notes: FlowMigrationNote[]): unknown {
  if (!isRecord(slot) || !Array.isArray(slot.accept)) return slot;
  const accept = slot.accept as unknown[];
  const isCsv = (v: unknown) => typeof v === 'string' && v.trim().toLowerCase() === '.csv';
  if (!accept.some(isCsv)) return slot;
  const label = typeof slot.key === 'string' ? slot.key : String(index);
  const kept = accept.filter((v) => !isCsv(v));
  if (kept.length === 0) {
    const rest: Record<string, unknown> = { ...slot };
    delete rest.accept;
    notes.push({ code: 'acceptCsvOnlyReplaced', slot: label });
    return rest;
  }
  notes.push({ code: 'acceptCsvRemoved', slot: label });
  return { ...slot, accept: kept };
}

export function migrateFlowDefinition(raw: unknown): FlowMigrationResult {
  const notes: FlowMigrationNote[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.inputSlots)) return { definition: raw, notes };
  const slots = raw.inputSlots as unknown[];
  const migrated = slots.map((s, i) => migrateSlot(s, i, notes));
  return notes.length === 0
    ? { definition: raw, notes }
    : { definition: { ...raw, inputSlots: migrated }, notes };
}

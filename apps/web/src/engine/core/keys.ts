import { isDecimal } from './decimal';
import type { Value } from './types';

/**
 * Normalized form of one key value, shared by `control.compare` key matching and the input slot
 * `unique` rule (decision 20261026): NFC, whitespace collapsed and trimmed, lowercase
 * ("nv00001 " = "NV00001"). Callers keep the original values for display.
 */
export function normalizeKeyPart(v: Value | undefined): string {
  if (v === null || v === undefined) return '';
  const s = isDecimal(v) ? v.toString() : String(v);
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

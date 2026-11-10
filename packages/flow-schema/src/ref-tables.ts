/**
 * Reference tables used by a flow (spec §34). No Zod here: the main thread imports this file
 * (`@hrflow/flow-schema/ref-tables`) without pulling the schemas into its chunks.
 */
const REF_TABLE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Codes of the reference tables a flow definition uses (spec §34 AC-RT-09): `input.refTable`
 * nodes (`config.refTable`) and list params (`options.fromRefTable`); distinct, sorted, ill-formed
 * parts ignored. Same rule as the database (`private.flow_ref_tables`, `flow_versions.ref_tables`).
 */
export function flowRefTables(definition: unknown): string[] {
  const out = new Set<string>();
  if (!isObject(definition)) return [];
  for (const n of Array.isArray(definition.nodes) ? definition.nodes : []) {
    if (!isObject(n) || n.type !== 'input.refTable' || !isObject(n.config)) continue;
    const code = n.config.refTable;
    if (typeof code === 'string' && REF_TABLE_CODE.test(code)) out.add(code);
  }
  for (const p of Array.isArray(definition.params) ? definition.params : []) {
    if (!isObject(p) || !isObject(p.options)) continue;
    const code = p.options.fromRefTable;
    if (typeof code === 'string' && REF_TABLE_CODE.test(code)) out.add(code);
  }
  return [...out].sort();
}

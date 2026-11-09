import type { Translate } from './core/types';

/**
 * Field labels of an input slot / flow param config path for people (HANDOFF §4.12a, MEMORY
 * 2026-11-06 18:27): `columns.0.rules.1.regex` reads "Cột 1, Quy tắc kiểm tra, dòng 2, Biểu thức
 * regex" — the labels of the Designer forms (tabs Input slot / Tham số), never the internal key.
 * The labels live in `engine-fields.json` (namespace `engineFields`, loaded by the worker only, so
 * not in the app entry) because the publish check of the Version screen shows these messages too,
 * without the Designer namespace; a unit test keeps them equal to the form labels of
 * `designer.json`.
 */

/** Groups whose children are said by the child label alone (`multiple.minFiles` → "Số file tối thiểu"). */
const GROUPS = new Set(['sheet', 'stopAt', 'skipRows', 'multiple']);

export function setupFieldLabel(t: Translate, kind: 'slot' | 'param', path: string): string {
  const segs = path === '' ? [] : path.split('.');
  const parts: string[] = [];
  const label = (key: string) => t(`engineFields:${key}`, { defaultValue: '' });
  let ctx: 'slot' | 'param' | 'column' | 'rule' | 'option' = kind;
  let group = -1; // index in `parts` of the group label to replace with a child label
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (/^\d+$/.test(seg)) {
      const n = Number(seg) + 1;
      const prev = segs[i - 1];
      if (ctx === 'slot' && prev === 'columns') {
        parts[parts.length - 1] = t('engineFields:columnN', { n });
        ctx = 'column';
      } else {
        parts.push(t('engineFields:row', { n }));
        if (ctx === 'column' && prev === 'rules') ctx = 'rule';
        if (ctx === 'param' && prev === 'options') ctx = 'option';
      }
      continue;
    }
    const own = label(`${ctx}.${seg}`);
    if (group >= 0 && own) {
      parts[group] = own;
      group = -1;
      continue;
    }
    if (!own) continue; // inner key without a field of its own (`sheet.value`, `stopAt.blankRows`)
    parts.push(own);
    group = ctx === 'slot' && GROUPS.has(seg) ? parts.length - 1 : -1;
  }
  return parts.length > 0 ? parts.join(', ') : label('other');
}

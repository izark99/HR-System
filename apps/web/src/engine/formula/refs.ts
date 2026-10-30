/**
 * Column references of a formula (spec §12.2): typed as `[Tiêu đề]` or `[key]`, stored as
 * `[key]`, shown by title. Titles match case-insensitively; a title shared by 2 columns is
 * ambiguous (the reference must use the key).
 */

export interface RefColumn {
  key: string;
  title: string;
}

export function normTitle(s: string): string {
  return s.normalize('NFC').trim().toLowerCase();
}

export function escapeRef(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

/**
 * Rewrite every complete `[...]` reference outside string literals. Tolerant: an unterminated
 * string or reference stops the rewriting (the text stays as typed from there).
 */
export function mapRefs(text: string, fn: (name: string) => string | null): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= text.length) return out + text.slice(i);
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (ch === '[') {
      let j = i + 1;
      let name = '';
      for (;;) {
        if (j >= text.length) return out + text.slice(i);
        if (text[j] === ']') {
          if (text[j + 1] === ']') {
            name += ']';
            j += 2;
            continue;
          }
          j++;
          break;
        }
        name += text[j];
        j++;
      }
      const repl = fn(name);
      out += repl === null ? text.slice(i, j) : escapeRef(repl);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export type Resolved = { kind: 'ok'; key: string } | { kind: 'ambiguous' } | { kind: 'missing' };

/** Resolve a reference name: exact key first, then a unique title. */
export function resolveRef(name: string, columns: readonly RefColumn[]): Resolved {
  if (columns.some((c) => c.key === name)) return { kind: 'ok', key: name };
  const n = normTitle(name);
  const hits = columns.filter((c) => normTitle(c.title) === n);
  if (hits.length === 1) return { kind: 'ok', key: hits[0]!.key };
  return hits.length > 1 ? { kind: 'ambiguous' } : { kind: 'missing' };
}

/** `[Tiêu đề]` → `[key]` (unresolvable references stay as typed). */
export function toStored(text: string, columns: readonly RefColumn[]): string {
  return mapRefs(text, (name) => {
    const r = resolveRef(name, columns);
    return r.kind === 'ok' ? r.key : null;
  });
}

/** `[key]` → `[Tiêu đề]` when the title resolves back to the same column; else keeps the key. */
export function toDisplay(text: string, columns: readonly RefColumn[]): string {
  return mapRefs(text, (name) => {
    const col = columns.find((c) => c.key === name);
    if (!col || !col.title) return null;
    const back = resolveRef(col.title, columns);
    return back.kind === 'ok' && back.key === col.key ? col.title : null;
  });
}

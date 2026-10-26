/**
 * Header normalization for alias matching (spec §10): strip Vietnamese diacritics, lowercase,
 * collapse whitespace (incl. line breaks and non-breaking spaces inside header cells).
 * Punctuation is kept so that "OT (giờ)" and "OT" stay distinct.
 */
export function normalizeHeader(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[\s\u00a0\u200b]+/g, ' ')
    .trim();
}

/** snake_case identifier from a header, for columns kept via `extraColumns: keep`. */
export function slugifyHeader(text: string): string {
  const slug = normalizeHeader(text)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (slug === '') return 'col';
  return /^[0-9]/.test(slug) ? `col_${slug}` : slug;
}

import { describe, expect, it } from 'vitest';
import { buildCatalog, GROUP_PREFIXES, groupOf, UI_TEXT_GROUPS } from '../catalog';
import {
  checkText,
  fillSample,
  foldText,
  hasHtml,
  maxLength,
  restoreFormats,
  splitVars,
  valueToSave,
} from '../text-rules';

describe('catalog (spec §33 AC-TX-02)', () => {
  const list = buildCatalog();

  it('lists every text of every namespace once', () => {
    expect(list.length).toBeGreaterThan(1400);
    expect(new Set(list.map((e) => e.key)).size).toBe(list.length);
    for (const ns of ['common', 'designer', 'engine', 'engineFields', 'uiText', 'refTables']) {
      expect(list.some((e) => e.key.startsWith(`${ns}:`))).toBe(true);
    }
    // Keys fit the database check.
    for (const e of list) expect(e.key).toMatch(/^[a-zA-Z]+:[A-Za-z0-9_.-]+$/);
    for (const e of list) expect(e.key.length).toBeLessThanOrEqual(200);
  });

  it('every key belongs to exactly one group through the prefix table (none falls outside)', () => {
    const orphans = list.filter((e) => groupOf(e.key) === null).map((e) => e.key);
    expect(orphans).toEqual([]);
    for (const g of Object.values(GROUP_PREFIXES)) expect(UI_TEXT_GROUPS).toContain(g);
    // Every group is used.
    for (const g of UI_TEXT_GROUPS) expect(list.some((e) => e.group === g)).toBe(true);
  });

  it('the most specific prefix wins', () => {
    expect(groupOf('common:admin.nav.users')).toBe('common');
    expect(groupOf('common:admin.users.create')).toBe('admin');
    expect(groupOf('designer:formula.fn.IF.desc')).toBe('functions');
    expect(groupOf('designer:palette.title')).toBe('designer');
    expect(groupOf('engine:validation.required')).toBe('validation');
    expect(groupOf('engine:executor.error.outOfMemory')).toBe('runtime');
    expect(groupOf('engine:design.error.cycle')).toBe('designer');
    expect(groupOf('common:auth.login.title')).toBe('auth');
    // "common:admin" must not catch "common:adminX".
    expect(groupOf('common:adminX.y')).toBeNull();
  });

  it('code shown: bare path for common, ns:path otherwise; a new namespace shows by itself', () => {
    const extra = buildCatalog({ common: { a: { b: 'x' } }, newNs: { c: 'y' } });
    expect(extra.map((e) => [e.key, e.code, e.group])).toEqual([
      ['common:a.b', 'a.b', 'common'],
      ['newNs:c', 'newNs:c', 'common'],
    ]);
  });
});

describe('checkText (AC-TX-03, AC-TX-10)', () => {
  const orig = 'File {{file}}, dòng {{row}}: cột "{{column}}" không được để trống.';

  it('accepts a text with the same variables', () => {
    expect(checkText(orig, 'Dòng {{row}} của {{file}}: thiếu "{{column}}".')).toBeNull();
  });
  it('empty', () => {
    expect(checkText(orig, '   ')).toEqual({ kind: 'empty' });
  });
  it('missing variable, named', () => {
    expect(checkText(orig, 'File {{file}}: thiếu cột.')).toEqual({
      kind: 'missing',
      vars: ['column', 'row'],
    });
  });
  it('extra / misspelled variable', () => {
    expect(checkText(orig, '{{file}} {{row}} {{column}} {{cot}}')).toEqual({
      kind: 'extra',
      vars: ['cot'],
    });
    expect(checkText(orig, '{{file}} {{row}} {{Column}}')).toEqual({
      kind: 'missing',
      vars: ['column'],
    });
  });
  it('length ≤ max(2 × original, 40)', () => {
    expect(maxLength('Lưu')).toBe(40);
    expect(maxLength(orig)).toBe(orig.length * 2);
    expect(maxLength('x'.repeat(1500))).toBe(2000);
    expect(checkText('Lưu', 'a'.repeat(40))).toBeNull();
    expect(checkText('Lưu', 'a'.repeat(41))).toEqual({ kind: 'tooLong', max: 40 });
  });
  it('HTML tags are refused, plain "<" is not', () => {
    expect(checkText('Lưu', 'Lưu <b>ngay</b>')).toEqual({ kind: 'html' });
    expect(checkText('Lưu', '<a href=x>Lưu</a>')).toEqual({ kind: 'html' });
    expect(checkText('Lưu', '<!-- x -->')).toEqual({ kind: 'html' });
    expect(hasHtml('[A]<5 hoặc <> 0')).toBe(false);
  });
});

describe('variable format (AC-TX-11): the default format is put back when saving', () => {
  const orig = 'Kỳ {{period}} có {{count, number}} nhân viên lệch';

  it('{{count}} typed → {{count, number}} stored', () => {
    expect(restoreFormats(orig, 'Có {{count}} người lệch kỳ {{period}}')).toBe(
      'Có {{count, number}} người lệch kỳ {{period}}',
    );
    expect(checkText(orig, 'Có {{count}} người lệch kỳ {{period}}')).toBeNull();
  });
  it('a format typed by the Admin is kept', () => {
    expect(restoreFormats(orig, '{{count, number}} · {{period}}')).toBe(
      '{{count, number}} · {{period}}',
    );
  });
  it('the text the default resolves to is "back to default" (null)', () => {
    expect(valueToSave(orig, 'Kỳ {{period}} có {{count}} nhân viên lệch')).toBeNull();
    expect(valueToSave(orig, 'Kỳ {{period}}: {{count}} lệch')).toBe(
      'Kỳ {{period}}: {{count, number}} lệch',
    );
  });
});

describe('helpers', () => {
  it('fillSample replaces variables with fixed sample values', () => {
    expect(fillSample('Kỳ {{period}} có {{count, number}} người, {{unknown}}')).toBe(
      'Kỳ 09/2026 có 9 người, unknown',
    );
  });
  it('foldText ignores Vietnamese diacritics and case', () => {
    expect(foldText('Đăng NHẬP')).toBe('dang nhap');
    expect(foldText('Văn bản giao diện').includes(foldText('van ban'))).toBe(true);
  });
  it('splitVars', () => {
    expect(splitVars('A {{x}} B')).toEqual([
      { text: 'A ', isVar: false },
      { text: '{{x}}', isVar: true },
      { text: ' B', isVar: false },
    ]);
  });
});

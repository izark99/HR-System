import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import viCommon from '../locales/vi/common.json';
import { sameVars, textVars } from './text-vars';
import {
  applyTextOverrides,
  loadTextOverrides,
  setTextOverrides,
  textGeneration,
  textOverrides,
} from './ui-text';
import type { Supabase } from './supabase';

describe('textVars (spec §33 AC-TX-11)', () => {
  it('names only, format and duplicates dropped, sorted', () => {
    expect(textVars('{{count, number}} lỗi ở {{file}}, {{count}}')).toEqual(['count', 'file']);
    expect(textVars('{{- name}} và {{a.b}}')).toEqual(['a.b', 'name']);
    expect(textVars('Không có biến')).toEqual([]);
  });
  it('sameVars ignores the format', () => {
    expect(sameVars('{{count}} file', 'Có {{count, number}} file')).toBe(true);
    expect(sameVars('{{count}}', '{{total}}')).toBe(false);
  });
});

describe('UI text overrides in i18next (AC-TX-05)', () => {
  afterEach(() => {
    setTextOverrides(
      Object.keys(textOverrides(['common', 'designer', 'engine'])).map((k) => [k, null]),
    );
  });

  it('applies an edited text, re-renders, and restores the default', () => {
    const changed = vi.fn();
    i18next.on('languageChanged', changed);
    const before = textGeneration();
    setTextOverrides([['common:auth.login.title', 'Đăng nhập hệ thống']]);
    expect(i18next.t('auth.login.title')).toBe('Đăng nhập hệ thống');
    expect(changed).toHaveBeenCalled();
    expect(textGeneration()).toBe(before + 1);
    // The default JSON itself is never changed.
    expect(viCommon.auth.login.title).toBe('Đăng nhập');
    setTextOverrides([['common:auth.login.title', null]]);
    expect(i18next.t('auth.login.title')).toBe('Đăng nhập');
    i18next.off('languageChanged', changed);
  });

  it('keeps the variables working, ignores unknown keys and texts with other variables', () => {
    setTextOverrides([
      ['common:flows.runNamed', 'Bắt đầu {{name}}'],
      ['common:flows.gone.key', 'X'],
      ['common:flows.version', 'Bản {{other}}'],
    ]);
    expect(i18next.t('flows.runNamed', { name: 'A' })).toBe('Bắt đầu A');
    expect(i18next.exists('flows.gone.key')).toBe(false);
    expect(i18next.t('flows.version', { version: 'v3' })).toBe('Phiên bản v3');
  });

  it('a namespace loaded later gets its texts when it loads', () => {
    setTextOverrides([['lazyns:hello', 'Xin chào mới']]);
    i18next.addResourceBundle('vi', 'lazyns', { hello: 'Xin chào' });
    expect(i18next.t('lazyns:hello')).toBe('Xin chào');
    applyTextOverrides('lazyns');
    expect(i18next.t('lazyns:hello')).toBe('Xin chào mới');
  });

  it('textOverrides filters by namespace (what the engine worker gets)', () => {
    setTextOverrides([
      ['common:app.name', 'App'],
      ['engine:validation.required', 'Thiếu {{column}} ở {{file}} dòng {{row}}'],
    ]);
    expect(Object.keys(textOverrides(['engine', 'engineFields']))).toEqual([
      'engine:validation.required',
    ]);
  });
});

function fakeClient(result: Promise<{ data: unknown }>): Supabase {
  const chain = {
    select: () => chain,
    not: () => chain,
    then: (ok: (r: { data: unknown }) => unknown, fail: (e: unknown) => unknown) =>
      result.then(ok, fail),
  };
  return { from: () => chain } as unknown as Supabase;
}

describe('loadTextOverrides', () => {
  afterEach(() => setTextOverrides([['common:auth.login.title', null]]));

  it('applies the rows read from the table', async () => {
    await loadTextOverrides(
      fakeClient(Promise.resolve({ data: [{ key: 'common:auth.login.title', value: 'Vào' }] })),
    );
    expect(i18next.t('auth.login.title')).toBe('Vào');
  });

  it('a network failure keeps the defaults and does not throw', async () => {
    await expect(
      loadTextOverrides(fakeClient(Promise.reject(new Error('offline')))),
    ).resolves.toBeUndefined();
    expect(i18next.t('auth.login.title')).toBe('Đăng nhập');
  });

  it('does not wait longer than waitMs; a late answer is still applied', async () => {
    let answer!: (r: { data: unknown }) => void;
    const late = new Promise<{ data: unknown }>((r) => (answer = r));
    await loadTextOverrides(fakeClient(late), 10);
    expect(i18next.t('auth.login.title')).toBe('Đăng nhập');
    answer({ data: [{ key: 'common:auth.login.title', value: 'Muộn' }] });
    await late;
    await Promise.resolve();
    expect(i18next.t('auth.login.title')).toBe('Muộn');
  });
});

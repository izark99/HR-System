import { afterEach, describe, expect, it } from 'vitest';
import viEngine from '../../locales/vi/engine.json';
import { createEngineTranslator, setEngineTextOverrides } from '../core/i18n';

/** Texts edited by Admins reach the worker's translator (spec §33 AC-TX-05). */
describe('engine translator with edited texts', () => {
  afterEach(() => setEngineTextOverrides({}));
  const params = { file: 'luong_CN01.xlsx', row: 12, column: 'Mã NV' };

  it('uses the edited text, also in a translator created before the texts arrived', () => {
    const early = createEngineTranslator('vi');
    setEngineTextOverrides({
      'engine:validation.required': 'File {{file}}, dòng {{row}}: thiếu "{{column}}".',
      'engineFields:row': 'Hàng {{n}}',
    });
    const late = createEngineTranslator('vi');
    for (const t of [early, late]) {
      expect(t('validation.required', params)).toBe(
        'File luong_CN01.xlsx, dòng 12: thiếu "Mã NV".',
      );
      expect(t('engineFields:row', { n: 3 })).toBe('Hàng 3');
    }
    expect(viEngine.validation.required).toContain('không được để trống');
  });

  it('ignores other namespaces, unknown keys and texts whose variables differ', () => {
    setEngineTextOverrides({
      'common:app.name': 'X',
      'engine:validation.nope': 'Y',
      'engine:validation.required': 'Thiếu {{cot}}',
    });
    const t = createEngineTranslator('vi');
    expect(t('validation.required', params)).toBe(
      'File luong_CN01.xlsx, dòng 12: cột "Mã NV" không được để trống.',
    );
  });

  it('back to the defaults when the texts are cleared', () => {
    const t = createEngineTranslator('vi');
    setEngineTextOverrides({ 'engine:validation.required': '{{file}} {{row}} {{column}}' });
    expect(t('validation.required', params)).toBe('luong_CN01.xlsx 12 Mã NV');
    setEngineTextOverrides({});
    expect(t('validation.required', params)).toContain('không được để trống');
  });
});

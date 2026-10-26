import { describe, expect, it } from 'vitest';
import { Big } from '../core/decimal';
import { normalizeKeyPart } from '../core/keys';

describe('normalizeKeyPart', () => {
  it('ignores case, surrounding and repeated whitespace, and Unicode composition', () => {
    expect(normalizeKeyPart(' nv00001 ')).toBe('nv00001');
    expect(normalizeKeyPart('NV\t 00001')).toBe('nv 00001');
    expect(normalizeKeyPart('NVÁ')).toBe(normalizeKeyPart('nvá'));
  });

  it('maps null/undefined to "" and renders decimals canonically', () => {
    expect(normalizeKeyPart(null)).toBe('');
    expect(normalizeKeyPart(undefined)).toBe('');
    expect(normalizeKeyPart(new Big('1.50'))).toBe('1.5');
    expect(normalizeKeyPart(12)).toBe('12');
  });
});

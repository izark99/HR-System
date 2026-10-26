import { describe, expect, it } from 'vitest';
import { formatCell, formatDecimalString, formatMonth, formatSeconds } from './format';

const t = (k: string) => k;

describe('vi display formatting', () => {
  it('formats decimal strings without float conversion', () => {
    expect(formatDecimalString('1234567.89')).toBe('1.234.567,89');
    expect(formatDecimalString('-2')).toBe('-2');
    expect(formatDecimalString('0.5')).toBe('0,5');
    expect(formatDecimalString('12345678901234567890.123456789')).toBe(
      '12.345.678.901.234.567.890,123456789',
    );
    expect(formatDecimalString('abc')).toBe('abc');
  });

  it('formats cells by type', () => {
    expect(formatCell('2026-09-30', 'date', t)).toBe('30/09/2026');
    expect(formatCell(1234, 'integer', t)).toBe('1.234');
    expect(formatCell('0.5', 'decimal', t)).toBe('0,5');
    expect(formatCell(null, 'decimal', t)).toBe('');
    expect(formatCell('00123', 'string', t)).toBe('00123');
    expect(formatCell(true, 'boolean', t)).toBe('common.yes');
  });

  it('formats month and seconds', () => {
    expect(formatMonth('2026-09')).toBe('09/2026');
    expect(formatSeconds(1234)).toBe('1,2');
    expect(formatSeconds(37)).toBe('0,04');
  });
});

import { describe, expect, it } from 'vitest';
import type { Big } from '../core/decimal';
import { decimalFromNumber } from '../core/decimal';
import {
  coerceValue,
  excelSerialToParts,
  formatDate,
  normalizeNumberText,
  parseDateString,
} from '../io/coerce';
import { normalizeHeader, slugifyHeader } from '../io/normalize';

describe('normalizeHeader', () => {
  it.each([
    ['Mã NV', 'ma nv'],
    ['  MÃ   NHÂN\nVIÊN ', 'ma nhan vien'],
    ['Đơn vị', 'don vi'],
    ['Công thực tế', 'cong thuc te'],
    ['OT (giờ)', 'ot (gio)'],
    ['Nghỉ không lương', 'nghi khong luong'],
  ])('%j → %j', (input, out) => {
    expect(normalizeHeader(input)).toBe(out);
  });

  it('treats precomposed and decomposed Vietnamese the same', () => {
    expect(normalizeHeader('Họ và tên'.normalize('NFC'))).toBe(
      normalizeHeader('Họ và tên'.normalize('NFD')),
    );
  });

  it('slugifies extra headers', () => {
    expect(slugifyHeader('Phòng ban')).toBe('phong_ban');
    expect(slugifyHeader('1. Ghi chú')).toBe('col_1_ghi_chu');
  });
});

describe('date parsing', () => {
  it('converts Excel serials (1900 system, incl. leap-year bug)', () => {
    expect(formatDate(excelSerialToParts(46266)!)).toBe('2026-09-01');
    expect(formatDate(excelSerialToParts(1)!)).toBe('1900-01-01');
    expect(formatDate(excelSerialToParts(59)!)).toBe('1900-02-28');
    expect(excelSerialToParts(60)).toBeNull(); // fictitious 1900-02-29
    expect(formatDate(excelSerialToParts(61)!)).toBe('1900-03-01');
    expect(excelSerialToParts(0)).toBeNull();
  });

  it('converts 1904-system serials', () => {
    expect(formatDate(excelSerialToParts(0, true)!)).toBe('1904-01-01');
  });

  it('keeps the time of day of a serial', () => {
    const p = excelSerialToParts(46266.75)!;
    expect([p.hh, p.mi, p.ss]).toEqual([18, 0, 0]);
  });

  it('parses dd/MM/yyyy strictly as day-first and validates the calendar', () => {
    expect(parseDateString('01/09/2026', 'dd/MM/yyyy')).toMatchObject({ y: 2026, m: 9, d: 1 });
    expect(parseDateString('1/9/2026', 'dd/MM/yyyy')).toMatchObject({ y: 2026, m: 9, d: 1 });
    expect(parseDateString('31/02/2026', 'dd/MM/yyyy')).toBeNull();
    expect(parseDateString('29/02/2028', 'dd/MM/yyyy')).toMatchObject({ m: 2, d: 29 });
    expect(parseDateString('2026-09-01', 'dd/MM/yyyy')).toBeNull();
  });

  it('coerces date values via the column formats', () => {
    const formats = ['dd/MM/yyyy', 'excelSerial'];
    expect(coerceValue(46266, 'date', { dateFormats: formats })).toEqual({
      ok: true,
      value: '2026-09-01',
    });
    expect(coerceValue('15/09/2026', 'date', { dateFormats: formats })).toEqual({
      ok: true,
      value: '2026-09-15',
    });
    expect(coerceValue(46266, 'date', { dateFormats: ['dd/MM/yyyy'] })).toEqual({ ok: false });
    expect(coerceValue('13/13/2026', 'date', { dateFormats: formats })).toEqual({ ok: false });
    expect(
      coerceValue('15/09/2026 08:30:00', 'datetime', {
        dateFormats: ['dd/MM/yyyy HH:mm:ss'],
      }),
    ).toEqual({ ok: true, value: '2026-09-15T08:30:00' });
  });
});

describe('number coercion', () => {
  it('normalizes text numbers by decimal separator', () => {
    expect(normalizeNumberText('1,234.5', '.')).toBe('1234.5');
    expect(normalizeNumberText('1.234,5', ',')).toBe('1234.5');
    expect(normalizeNumberText('25,5', ',')).toBe('25.5');
    expect(normalizeNumberText('1,5', '.')).toBeNull();
    expect(normalizeNumberText('abc', '.')).toBeNull();
    expect(normalizeNumberText(' -0.5 ', '.')).toBe('-0.5');
  });

  it('removes float noise from Excel numbers', () => {
    expect(decimalFromNumber(0.1 + 0.2).toString()).toBe('0.3');
    expect(decimalFromNumber(25.499999999999996).toString()).toBe('25.5');
  });

  it('coerces decimals without float arithmetic', () => {
    const r = coerceValue('0.1', 'decimal');
    expect(r.ok && (r.value as InstanceType<typeof Big>).plus('0.2').eq('0.3')).toBe(true);
  });

  it('coerces integers, strings and booleans', () => {
    expect(coerceValue(12, 'integer')).toEqual({ ok: true, value: 12 });
    expect(coerceValue(12.5, 'integer')).toEqual({ ok: false });
    expect(coerceValue(12345, 'string')).toEqual({ ok: true, value: '12345' });
    expect(coerceValue('  NV00001 ', 'string')).toEqual({ ok: true, value: 'NV00001' });
    expect(coerceValue('Có', 'boolean')).toEqual({ ok: true, value: true });
    expect(coerceValue('không', 'boolean')).toEqual({ ok: true, value: false });
    expect(coerceValue('maybe', 'boolean')).toEqual({ ok: false });
    expect(coerceValue('   ', 'decimal')).toEqual({ ok: true, value: null });
  });
});

import { FlowDefinitionSchema } from '@hrflow/flow-schema';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../../engine/protocol';
import { asOfFromParams, todayIso } from '../as-of';
import { buildRunLog, sha256Hex } from '../run-log';

const FIXTURES = resolve(import.meta.dirname, '../../../../../../fixtures/payroll-timesheet');
const flow = FlowDefinitionSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8')),
);

const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const summary = {
  durationMs: 1234.4,
  sheets: [
    { id: 's1', name: 'Tổng hợp', role: 'summary', rowCount: 4, columns: [] },
    { id: 's2', name: 'Lệch', role: 'mismatched', rowCount: 9, columns: [] },
  ],
} as unknown as RunSummary;

describe('buildRunLog (metadata only, spec §7.1)', () => {
  it('hashes file names with SHA-256 (Web Crypto), keeps sizes and row counts', async () => {
    expect(await sha256Hex('bảng_lương_Nguyễn Văn A.xlsx')).toBe(
      nodeSha('bảng_lương_Nguyễn Văn A.xlsx'),
    );
    const entry = await buildRunLog({
      flowVersionId: 'v1',
      flowParams: flow.params,
      params: { ky_luong: '2026-09' },
      slots: [
        { key: 'bang_luong', files: [{ name: 'Luong_Nguyễn Văn A.xlsx', size: 2048 }], rows: 75 },
        { key: 'cham_cong', files: [], rows: null },
      ],
      status: 'succeeded',
      durationMs: 99,
      summary,
      error: null,
    });
    expect(entry).toEqual({
      flow_version_id: 'v1',
      params: { ky_luong: '2026-09' },
      inputs_meta: [
        {
          slot: 'bang_luong',
          rows: 75,
          files: [{ sha256: nodeSha('Luong_Nguyễn Văn A.xlsx'), size: 2048 }],
        },
        { slot: 'cham_cong', rows: 0, files: [] },
      ],
      status: 'succeeded',
      duration_ms: 99,
      rows_out: 13,
      error_code: null,
      error_node_id: null,
      client_info: null,
    });
    expect(JSON.stringify(entry)).not.toContain('Nguyễn');
  });

  it('drops params marked log:false, empty params, and truncates long text', async () => {
    const entry = await buildRunLog({
      flowVersionId: 'v1',
      flowParams: [
        { key: 'ky', label: 'Kỳ', type: 'month', required: true, log: true },
        { key: 'ghi_chu', label: 'Ghi chú', type: 'string', required: false, log: true },
        { key: 'bi_mat', label: 'Bí mật', type: 'string', required: false, log: false },
        { key: 'trong', label: 'Trống', type: 'string', required: false, log: true },
      ],
      params: {
        ky: '2026-09',
        ghi_chu: 'x'.repeat(500),
        bi_mat: 'NV00001 Nguyễn Văn A',
        trong: '',
      },
      slots: [],
      status: 'cancelled',
      durationMs: 5,
      summary: null,
      error: null,
    });
    expect(entry.params).toEqual({ ky: '2026-09', ghi_chu: 'x'.repeat(100) });
    expect(JSON.stringify(entry)).not.toContain('Nguyễn');
    expect(entry.rows_out).toBeNull();
  });

  it('failed run: only the i18n key and node id, never error params (they can hold cell values)', async () => {
    const entry = await buildRunLog({
      flowVersionId: 'v1',
      flowParams: [],
      params: {},
      slots: [],
      status: 'failed',
      durationMs: 7,
      summary: null,
      error: {
        messageKey: 'compare.error.duplicateKey',
        params: { value: 'NV00001', name: 'Nguyễn Văn A' },
        nodeId: 'cmp',
      },
    });
    expect(entry).toMatchObject({ error_code: 'compare.error.duplicateKey', error_node_id: 'cmp' });
    expect(JSON.stringify(entry)).not.toMatch(/NV00001|Nguyễn/);
    // Anything not shaped like a key/node id is dropped rather than stored.
    const odd = await buildRunLog({
      flowVersionId: 'v1',
      flowParams: [],
      params: {},
      slots: [],
      status: 'failed',
      durationMs: 7,
      summary: null,
      error: { messageKey: 'Lỗi dòng 5: NV00001', params: {}, nodeId: 'Bad Node' },
    });
    expect(odd).toMatchObject({ error_code: null, error_node_id: null });
  });
});

describe('as-of date (spec §14.2)', () => {
  it('month param → first day; date param → itself; otherwise today', () => {
    expect(asOfFromParams(flow.params, { ky_luong: '2026-09' }, '2026-10-26')).toBe('2026-09-01');
    expect(asOfFromParams(flow.params, { ky_luong: '' }, '2026-10-26')).toBe('2026-10-26');
    expect(asOfFromParams(flow.params, { ky_luong: '2026-13' }, '2026-10-26')).toBe('2026-10-26');
    const dateParam = [
      {
        key: 'ngay',
        label: 'Ngày',
        type: 'date' as const,
        required: true,
        log: true,
        isAsOfDate: true,
      },
    ];
    expect(asOfFromParams(dateParam, { ngay: '2026-02-28' }, 'T')).toBe('2026-02-28');
    expect(asOfFromParams(dateParam, { ngay: '2026-02-30' }, 'T')).toBe('T');
    expect(asOfFromParams([], {}, 'T')).toBe('T');
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

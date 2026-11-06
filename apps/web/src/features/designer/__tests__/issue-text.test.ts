import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import designer from '../../../locales/vi/designer.json';
import engine from '../../../locales/vi/engine.json';
import type { DesignIssue } from '../../../engine/design';
import { nodePlugins } from '../../../engine/nodes';
import { issueFieldLabel, issueText, withoutNode } from '../issue-text';

const i18n = i18next.createInstance();
void i18n.init({
  lng: 'vi',
  resources: { vi: { designer, engine } },
  ns: ['designer', 'engine'],
  defaultNS: 'designer',
  interpolation: { escapeValue: false },
  initAsync: false,
});
const t = (key: string, o?: Record<string, unknown>): string => String(i18n.t(key, o ?? {}));

const invalid = (path: string, node = 'Ghép bảng lương với danh sách nhân viên'): DesignIssue => ({
  severity: 'error',
  messageKey: 'executor.error.invalidConfig',
  params: { node, path },
  text: t('engine:executor.error.invalidConfig', { node, path }),
  nodeId: 'join_1',
  path,
});

/** Every object key found anywhere in a config schema. */
function schemaKeys(schema: z.ZodType, out = new Set<string>()): Set<string> {
  if (schema instanceof z.ZodObject) {
    for (const [k, v] of Object.entries<z.ZodType>(schema.shape)) {
      out.add(k);
      schemaKeys(v, out);
    }
  } else if (schema instanceof z.ZodArray) schemaKeys(schema.element as z.ZodType, out);
  else if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodNullable
  )
    schemaKeys(schema.unwrap() as z.ZodType, out);
  else if (schema instanceof z.ZodUnion)
    for (const o of schema.options as z.ZodType[]) schemaKeys(o, out);
  else if (schema instanceof z.ZodPipe) schemaKeys(schema.in as z.ZodType, out);
  return out;
}

describe('issue text (MEMORY 2026-11-06 18:27)', () => {
  it('names a config path by the field labels of the node form', () => {
    expect(issueFieldLabel(t, 'transform.join', 'on')).toBe('Cột khóa');
    expect(issueFieldLabel(t, 'transform.join', 'on.0.left')).toBe(
      'Cột khóa, dòng 1, Cột bảng trái',
    );
    expect(issueFieldLabel(t, 'control.compare', 'metrics.1.left')).toBe(
      'Chỉ tiêu đối chiếu, dòng 2, Cột ở bảng trái (left)',
    );
    expect(issueFieldLabel(t, 'control.compare', 'sideLabels.left')).toBe(
      'Đặt tên cho 2 bảng, Tên bảng trái',
    );
    expect(issueFieldLabel(t, 'transform.dedupe', 'keys.0')).toBe('Cột khóa, dòng 1');
    expect(issueFieldLabel(t, 'transform.formula', 'columns.0.key')).toBe(
      'Cột công thức, dòng 1, Mã cột',
    );
    // Unknown key: a generic word, never the key itself.
    expect(issueFieldLabel(t, 'transform.join', 'zzz')).toBe('mục cấu hình');
  });

  it('every key of every node config schema has a label', () => {
    for (const [type, plugin] of Object.entries(nodePlugins)) {
      const keys = schemaKeys(plugin.configSchema as z.ZodType);
      expect(keys.size, type).toBeGreaterThan(0);
      for (const k of keys) {
        const label = issueFieldLabel(t, type, k);
        expect(label, `${type} ${k}`).not.toBe('mục cấu hình');
        expect(label, `${type} ${k}`).not.toBe(k);
      }
    }
    expect(Object.keys(nodePlugins).length).toBeGreaterThanOrEqual(13);
  });

  it('in the node panel: no node name, no internal key', () => {
    const text = issueText(t, invalid('on.0.left'), 'transform.join', true);
    expect(text).toBe('Cột bảng trái: giá trị chưa hợp lệ hoặc còn thiếu.');
    expect(issueText(t, invalid('keys.0'), 'transform.dedupe', true)).toBe(
      'Cột khóa, dòng 1: giá trị chưa hợp lệ hoặc còn thiếu.',
    );
    expect(text).not.toContain('Ghép bảng');
    expect(text).not.toMatch(/\bon\b|mục/);
  });

  it('elsewhere (status bar, node tooltip): keeps the node name', () => {
    const text = issueText(t, invalid('keys'), 'transform.dedupe', false);
    expect(text).toBe(
      'Node "Ghép bảng lương với danh sách nhân viên": Cột khóa chưa hợp lệ hoặc còn thiếu.',
    );
  });

  it('other node messages lose their "Node …" prefix in the panel only', () => {
    const node = 'Lọc';
    const msg = t('engine:filter.error.unknownColumn', { node, column: 'x' });
    const issue: DesignIssue = {
      severity: 'error',
      messageKey: 'filter.error.unknownColumn',
      params: { node, column: 'x' },
      text: msg,
      nodeId: 'f',
      path: 'conditions.0.column',
    };
    expect(issueText(t, issue, 'transform.filter', true)).toBe('Cột "x" không có ở bước trước.');
    expect(issueText(t, issue, 'transform.filter', false)).toBe(msg);
    expect(withoutNode(t, `Cổng bắt buộc "in" của node "${node}" chưa được nối.`, node)).toBe(
      'Cổng bắt buộc "in" của node này chưa được nối.',
    );
    // Not a node issue: unchanged.
    const flow = { ...issue, nodeId: undefined };
    expect(issueText(t, flow, 'transform.filter', true)).toBe(msg);
  });
});

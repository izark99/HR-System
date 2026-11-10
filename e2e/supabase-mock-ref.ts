/**
 * Reference tables part of the hermetic Supabase mock (spec §34, round 1): PostgREST on
 * `ref_tables` / `ref_table_versions` and the `admin_*ref*` RPCs, with the database rules the app
 * relies on (Admins only, one draft, optimistic token, no overlap, published immutable, limits,
 * keys). Fake reference data only (branch list), never personal data.
 */
import type { Request } from '@playwright/test';
import type { InjectedFailure, MockUser } from './supabase-mock';

export interface MockRefColumn {
  key: string;
  title: string;
  type: 'string' | 'integer' | 'decimal' | 'date' | 'boolean';
  aliases: string[];
  isKey: boolean;
}

export interface MockRefTable {
  id: string;
  code: string;
  name: string;
  description: string;
  columns: MockRefColumn[];
  updated_at: string;
}

export type MockRefRow = Record<string, string | number | boolean>;

export interface MockRefVersion {
  id: string;
  ref_table_id: string;
  version_no: number;
  status: 'draft' | 'published' | 'retired' | 'discarded';
  effective_from: string | null;
  effective_to: string | null;
  change_note: string;
  rows: MockRefRow[];
  published_at: string | null;
  published_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

type Json = (status: number, data: unknown) => Promise<void>;

/** Fake branch list (round numbers, made-up names). */
export const BRANCH_COLUMNS: MockRefColumn[] = [
  { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string', aliases: ['Mã CN'], isKey: true },
  { key: 'ten_cn', title: 'Tên chi nhánh', type: 'string', aliases: ['Tên CN'], isKey: false },
  { key: 'vung', title: 'Vùng lương tối thiểu', type: 'integer', aliases: ['Vùng'], isKey: false },
];

export function branchRows(n: number, from = 1): MockRefRow[] {
  const names = ['Hồ Chí Minh', 'Hà Nội', 'Cần Thơ', 'Đà Nẵng', 'Hậu Giang', 'Bình Dương'];
  return Array.from({ length: n }, (_, i) => ({
    ma_cn: `CN${String(from + i).padStart(2, '0')}`,
    ten_cn: names[(from + i - 1) % names.length]!,
    vung: ((from + i) % 3) + 1,
  }));
}

const nkey = (v: unknown) =>
  typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase() : String(v);

/** A row with every key column filled (to check one other cell's type on its own). */
function keyStub(t: MockRefTable): MockRefRow {
  const out: MockRefRow = {};
  for (const c of t.columns.filter((x) => x.isKey))
    out[c.key] =
      c.type === 'integer'
        ? 1
        : c.type === 'boolean'
          ? true
          : c.type === 'date'
            ? '2026-01-01'
            : c.type === 'decimal'
              ? '1'
              : 'k';
  return out;
}

export class RefTablesMock {
  tables: MockRefTable[] = [];
  versions: MockRefVersion[] = [];
  /** Usage rows (`admin_ref_table_usage`). */
  usage: {
    ref_table_code: string;
    flow_id: string;
    flow_code: string;
    flow_name: string;
    version_no: number;
    status: string;
  }[] = [];
  /** Next RPC / PATCH fails with this (one-shot unless sticky). */
  failure: InjectedFailure | null = null;
  /** RPC bodies received, by name. */
  rpcBodies: { name: string; body: Record<string, unknown> }[] = [];
  /** audit_logs entries the database would write for "not personal data" confirmations. */
  confirmations: { table: string; context: string; columns: string[] }[] = [];
  private counter = 0;
  /** User read rule (set by SupabaseMock: tables of published versions of assigned flows). */
  userCanRead: (user: MockUser, code: string) => boolean = () => false;
  /** Version ids whose rows were read (once per run-page open, AC-RT-15 c). */
  rowReads: string[] = [];
  tableReads = 0;

  stamp(): string {
    this.counter++;
    return `2026-11-09T07:${String(10 + Math.floor(this.counter / 60)).padStart(2, '0')}:${String(this.counter % 60).padStart(2, '0')}.123456+00:00`;
  }

  /** A table with versions: `published` = [from, to?, rows] newest last; `draft` = rows. */
  seed(input: {
    code: string;
    name: string;
    columns?: MockRefColumn[];
    published?: { from: string; to?: string | null; rows: MockRefRow[]; note?: string }[];
    draft?: MockRefRow[];
    retired?: { from: string; to: string; rows: MockRefRow[] }[];
  }): MockRefTable {
    const id = `reftbl-${this.tables.length + 1}`;
    const t: MockRefTable = {
      id,
      code: input.code,
      name: input.name,
      description: '',
      columns: input.columns ?? BRANCH_COLUMNS,
      updated_at: '2026-11-01T01:00:00.000001+00:00',
    };
    this.tables.push(t);
    let no = 0;
    const add = (v: Omit<MockRefVersion, 'id' | 'ref_table_id' | 'version_no'>) =>
      this.versions.push({
        ...v,
        id: `${id}-v${++no}`,
        ref_table_id: id,
        version_no: no,
      });
    for (const r of input.retired ?? [])
      add({
        status: 'retired',
        effective_from: r.from,
        effective_to: r.to,
        change_note: 'Khởi tạo',
        rows: r.rows,
        published_at: '2026-01-02T01:00:00+00:00',
        published_by: '00000000-0000-4000-8000-00000000000a',
        updated_at: '2026-01-02T01:00:00.000001+00:00',
        updated_by: '00000000-0000-4000-8000-00000000000a',
      });
    for (const p of input.published ?? [])
      add({
        status: 'published',
        effective_from: p.from,
        effective_to: p.to ?? null,
        change_note: p.note ?? 'Cập nhật danh mục',
        rows: p.rows,
        published_at: '2026-06-28T01:00:00+00:00',
        published_by: '00000000-0000-4000-8000-00000000000a',
        updated_at: '2026-06-28T01:00:00.000001+00:00',
        updated_by: '00000000-0000-4000-8000-00000000000a',
      });
    if (input.draft)
      add({
        status: 'draft',
        effective_from: null,
        effective_to: null,
        change_note: '',
        rows: input.draft,
        published_at: null,
        published_by: null,
        updated_at: '2026-11-09T07:02:00.000001+00:00',
        updated_by: '00000000-0000-4000-8000-00000000000a',
      });
    return t;
  }

  draftOf(code: string): MockRefVersion | undefined {
    const t = this.tables.find((x) => x.code === code);
    return this.versions.find((v) => v.ref_table_id === t?.id && v.status === 'draft');
  }

  private versionRow(v: MockRefVersion, select: string) {
    const { rows, ...rest } = v;
    const out: Record<string, unknown> = { ...rest, row_count: rows.length };
    if (select.split(',').some((c) => c.trim() === 'rows')) out.rows = rows;
    return out;
  }

  /** Same checks as private.assert_ref_rows (message = the 22023 identifier). */
  private rowsProblem(t: MockRefTable, rows: unknown): string | null {
    if (!Array.isArray(rows)) return 'invalid_rows';
    if (rows.length > 50_000) return 'rows_too_many';
    const keys = t.columns.filter((c) => c.isKey);
    const seen = new Set<string>();
    for (const r of rows as Record<string, unknown>[]) {
      if (!r || typeof r !== 'object') return 'invalid_rows';
      for (const [k, v] of Object.entries(r)) {
        const c = t.columns.find((x) => x.key === k);
        if (!c) return 'invalid_rows';
        if (v === null) continue;
        const ok =
          c.type === 'string'
            ? typeof v === 'string'
            : c.type === 'integer'
              ? Number.isSafeInteger(v)
              : c.type === 'decimal'
                ? typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)
                : c.type === 'date'
                  ? typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
                  : typeof v === 'boolean';
        if (!ok) return 'invalid_rows';
      }
      if (keys.some((c) => r[c.key] === undefined || r[c.key] === null || nkey(r[c.key]) === ''))
        return 'key_blank';
      const k = keys.map((c) => nkey(r[c.key])).join('\u001f');
      if (seen.has(k)) return 'duplicate_key';
      seen.add(k);
    }
    return null;
  }

  private overlaps(v: MockRefVersion): boolean {
    return this.versions.some(
      (o) =>
        o.id !== v.id &&
        o.ref_table_id === v.ref_table_id &&
        o.status === 'published' &&
        v.status === 'published' &&
        (v.effective_to === null || o.effective_from! < v.effective_to) &&
        (o.effective_to === null || o.effective_to > v.effective_from!),
    );
  }

  private newVersion(tableId: string, rows: MockRefRow[], caller: MockUser): MockRefVersion {
    const no =
      Math.max(
        0,
        ...this.versions.filter((v) => v.ref_table_id === tableId).map((v) => v.version_no),
      ) + 1;
    const v: MockRefVersion = {
      id: `${tableId}-v${no}`,
      ref_table_id: tableId,
      version_no: no,
      status: 'draft',
      effective_from: null,
      effective_to: null,
      change_note: '',
      rows,
      published_at: null,
      published_by: null,
      updated_at: this.stamp(),
      updated_by: caller.id,
    };
    this.versions.push(v);
    return v;
  }

  /** Handles the request when it is about reference tables; false otherwise. */
  async handle(
    request: Request,
    url: URL,
    caller: MockUser | undefined,
    json: Json,
  ): Promise<boolean> {
    const path = url.pathname;
    const isRef =
      path === '/rest/v1/ref_tables' ||
      path === '/rest/v1/ref_table_versions' ||
      /^\/rest\/v1\/rpc\/admin_(save_ref_table|replace_ref_table_draft|create_ref_draft_from_version|publish_ref_table_draft|ref_table_usage)$/.test(
        path,
      );
    if (!isRef) return false;
    const method = request.method();
    const admin = caller?.role === 'admin' && caller.is_active;
    const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const eq = (f: string) => {
      const v = url.searchParams.get(f);
      return v?.startsWith('eq.') ? v.slice(3) : v?.startsWith('neq.') ? v : undefined;
    };
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
    } catch {
      body = {};
    }
    const fail = () => {
      const f = this.failure;
      if (!f) return null;
      if (!f.sticky) this.failure = null;
      return json(f.status, {
        code: f.code,
        message: f.code === '22023' ? 'invalid_rows' : 'injected',
      });
    };

    if (method === 'GET') {
      // RLS: Admins read everything; a User reads the tables listed in a published version of a
      // flow assigned to them, and only their published versions (round 2, AC-RT-09); anon nothing.
      const select = url.searchParams.get('select') ?? '*';
      const readable = (t: MockRefTable) =>
        admin || (caller !== undefined && caller.is_active && this.userCanRead(caller, t.code));
      const inList = (f: string) => {
        const raw = url.searchParams.get(f);
        if (!raw?.startsWith('in.(')) return null;
        return raw
          .slice(4, -1)
          .split(',')
          .map((x) => x.replace(/^"|"$/g, ''));
      };
      if (path === '/rest/v1/ref_tables') {
        this.tableReads++;
        const code = eq('code');
        const codes = inList('code');
        const list = this.tables.filter(
          (t) => readable(t) && (!code || t.code === code) && (!codes || codes.includes(t.code)),
        );
        await json(
          200,
          [...list].sort((a, b) => a.code.localeCompare(b.code)),
        );
        return true;
      }
      const id = eq('id');
      const tableId = eq('ref_table_id');
      const tableIds = inList('ref_table_id');
      const status = eq('status');
      const notDiscarded = url.searchParams.get('status') === 'neq.discarded';
      const list = this.versions
        .filter((v) => {
          const t = this.tables.find((x) => x.id === v.ref_table_id);
          if (!t || !readable(t)) return false;
          if (!admin && v.status !== 'published') return false;
          return (
            (!id || v.id === id) &&
            (!tableId || v.ref_table_id === tableId) &&
            (!tableIds || tableIds.includes(v.ref_table_id)) &&
            (!status ||
              url.searchParams.get('status') === 'neq.discarded' ||
              v.status === status) &&
            (!notDiscarded || v.status !== 'discarded')
          );
        })
        .sort((a, b) => b.version_no - a.version_no)
        .map((v) => {
          if (select.split(',').some((c) => c.trim() === 'rows')) this.rowReads.push(v.id);
          return this.versionRow(v, select);
        });
      await json(200, single ? (list[0] ?? null) : list);
      return true;
    }

    if (!admin) {
      await json(403, { code: '42501', message: 'forbidden' });
      return true;
    }
    const injected = fail();
    if (injected) {
      await injected;
      return true;
    }

    if (path === '/rest/v1/ref_table_versions' && method === 'PATCH') {
      const id = eq('id');
      const status = eq('status');
      const v = this.versions.find((x) => x.id === id && (!status || x.status === status));
      if (!v) {
        await json(200, []);
        return true;
      }
      const next = { ...v };
      if (typeof body.status === 'string') next.status = body.status as MockRefVersion['status'];
      if ('effective_to' in body) next.effective_to = (body.effective_to as string | null) ?? null;
      if (v.status === 'retired' || v.status === 'discarded') {
        await json(400, { code: 'HF001', message: 'ref_version_immutable' });
        return true;
      }
      if (next.effective_to && next.effective_from && next.effective_to <= next.effective_from) {
        await json(400, { code: '23514', message: 'check' });
        return true;
      }
      if (this.overlaps(next)) {
        await json(409, { code: '23P01', message: 'overlap' });
        return true;
      }
      Object.assign(v, next, { updated_at: this.stamp(), updated_by: caller.id });
      await json(200, [{ id: v.id }]);
      return true;
    }

    const name = path.replace('/rest/v1/rpc/', '');
    this.rpcBodies.push({ name, body });
    const audit = (tableId: string, context: string) => {
      const cols = body.p_personal_data_columns;
      if (Array.isArray(cols) && cols.length > 0)
        this.confirmations.push({ table: tableId, context, columns: cols as string[] });
    };

    if (name === 'admin_ref_table_usage') {
      await json(200, this.usage);
      return true;
    }
    if (name === 'admin_save_ref_table') {
      const cols = body.p_columns as MockRefColumn[];
      if (!Array.isArray(cols) || cols.length === 0 || !cols.some((c) => c.isKey)) {
        await json(400, { code: '22023', message: 'invalid_columns' });
        return true;
      }
      if (body.p_id === null) {
        const code = String(body.p_code);
        if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) {
          await json(400, { code: '23514', message: 'check' });
          return true;
        }
        if (this.tables.some((t) => t.code === code)) {
          await json(409, { code: '23505', message: 'duplicate' });
          return true;
        }
        const t: MockRefTable = {
          id: `reftbl-${this.tables.length + 1}`,
          code,
          name: String(body.p_name),
          description: String((body.p_description as string | undefined) ?? ''),
          columns: cols,
          updated_at: this.stamp(),
        };
        this.tables.push(t);
        const d = this.newVersion(t.id, [], caller);
        audit(t.id, 'columns');
        await json(200, [{ ref_table_id: t.id, updated_at: t.updated_at, draft_version_id: d.id }]);
        return true;
      }
      const t = this.tables.find((x) => x.id === body.p_id);
      if (!t) {
        await json(404, { code: 'P0002', message: 'ref_table_not_found' });
        return true;
      }
      if (t.updated_at !== body.p_expected_updated_at) {
        await json(409, { code: 'HF002', message: 'draft_conflict' });
        return true;
      }
      Object.assign(t, {
        name: String(body.p_name),
        description: String((body.p_description as string | undefined) ?? ''),
        columns: cols,
        updated_at: this.stamp(),
      });
      audit(t.id, 'columns');
      await json(200, [
        {
          ref_table_id: t.id,
          updated_at: t.updated_at,
          draft_version_id: this.draftOf(t.code)?.id ?? null,
        },
      ]);
      return true;
    }
    if (name === 'admin_replace_ref_table_draft') {
      const t = this.tables.find((x) => x.id === body.p_ref_table_id);
      if (!t) {
        await json(404, { code: 'P0002', message: 'ref_table_not_found' });
        return true;
      }
      const draft = this.draftOf(t.code);
      const expected = body.p_expected_updated_at ?? null;
      if ((draft && draft.updated_at !== expected) || (!draft && expected !== null)) {
        await json(409, { code: 'HF002', message: 'draft_conflict' });
        return true;
      }
      const problem = this.rowsProblem(t, body.p_rows);
      if (problem) {
        await json(400, { code: '22023', message: problem });
        return true;
      }
      audit(t.id, 'import');
      const rows = body.p_rows as MockRefRow[];
      const v = draft ?? this.newVersion(t.id, rows, caller);
      Object.assign(v, { rows, updated_at: this.stamp(), updated_by: caller.id });
      await json(200, [{ version_id: v.id, version_no: v.version_no, updated_at: v.updated_at }]);
      return true;
    }
    if (name === 'admin_create_ref_draft_from_version') {
      const src = this.versions.find((v) => v.id === body.p_version_id && v.status !== 'discarded');
      if (!src) {
        await json(404, { code: 'P0002', message: 'version_not_found' });
        return true;
      }
      if (this.versions.some((v) => v.ref_table_id === src.ref_table_id && v.status === 'draft')) {
        await json(409, { code: '23505', message: 'duplicate' });
        return true;
      }
      // private.project_ref_rows: rows put on the current columns (rollback after a change).
      const table = this.tables.find((x) => x.id === src.ref_table_id)!;
      const rows = src.rows.map((r) => {
        const out: MockRefRow = {};
        for (const c of table.columns) {
          const v = r[c.key];
          if (v === undefined || v === null) continue;
          out[c.key] = this.rowsProblem(table, [{ ...keyStub(table), [c.key]: v }]) ? String(v) : v;
        }
        return out;
      });
      const v = this.newVersion(src.ref_table_id, rows, caller);
      await json(200, [{ version_id: v.id, version_no: v.version_no, updated_at: v.updated_at }]);
      return true;
    }
    if (name === 'admin_publish_ref_table_draft') {
      const v = this.versions.find((x) => x.id === body.p_version_id);
      if (!v) {
        await json(404, { code: 'P0002', message: 'version_not_found' });
        return true;
      }
      if (!body.p_effective_from) {
        await json(400, { code: '22023', message: 'effective_from_required' });
        return true;
      }
      if (typeof body.p_change_note !== 'string' || !body.p_change_note.trim()) {
        await json(400, { code: '22023', message: 'change_note_required' });
        return true;
      }
      if (v.status !== 'draft') {
        await json(400, { code: 'HF001', message: 'ref_version_immutable' });
        return true;
      }
      if (v.updated_at !== body.p_expected_updated_at) {
        await json(409, { code: 'HF002', message: 'draft_conflict' });
        return true;
      }
      const owner = this.tables.find((x) => x.id === v.ref_table_id)!;
      const bad = this.rowsProblem(owner, v.rows);
      if (bad) {
        await json(400, { code: '22023', message: bad });
        return true;
      }
      const from = body.p_effective_from as string;
      const to = (body.p_effective_to as string | null) ?? null;
      const closing = body.p_close_previous
        ? this.versions.filter(
            (o) =>
              o.ref_table_id === v.ref_table_id &&
              o.status === 'published' &&
              o.effective_to === null &&
              o.effective_from! < from,
          )
        : [];
      const after = { ...v, status: 'published' as const, effective_from: from, effective_to: to };
      const saved = closing.map((o) => o.effective_to);
      for (const o of closing) o.effective_to = from;
      if (this.overlaps(after)) {
        closing.forEach((o, i) => (o.effective_to = saved[i]!));
        await json(409, { code: '23P01', message: 'overlap' });
        return true;
      }
      Object.assign(v, after, {
        change_note: body.p_change_note.trim(),
        published_at: '2026-11-09T07:30:00+00:00',
        published_by: caller.id,
        updated_at: this.stamp(),
      });
      await json(200, [{ version_id: v.id, version_no: v.version_no }]);
      return true;
    }
    return false;
  }
}

/** Reference tables (spec §34): one table used by a flow, 2 published + 1 draft, a second one. */
export function seedDemoRefTables(ref: RefTablesMock): void {
  ref.seed({
    code: 'DM_CHI_NHANH',
    name: 'Danh mục chi nhánh',
    published: [
      { from: '2026-01-01', to: '2026-07-01', rows: branchRows(24), note: 'Thêm CN23, CN24' },
      {
        from: '2026-07-01',
        rows: branchRows(24).map((r, i) => (i === 4 ? { ...r, vung: 2 } : r)),
        note: 'Đổi vùng CN05 3 → 2',
      },
    ],
    draft: branchRows(26),
  });
  ref.seed({
    code: 'MAP_MA_CA',
    name: 'Mapping mã ca làm việc',
    columns: [
      { key: 'ma_ca', title: 'Mã ca', type: 'string', aliases: [], isKey: true },
      { key: 'gio_bat_dau', title: 'Giờ bắt đầu', type: 'string', aliases: [], isKey: false },
      { key: 'he_so', title: 'Hệ số', type: 'decimal', aliases: [], isKey: false },
    ],
    draft: [],
  });
  ref.usage = [
    {
      ref_table_code: 'DM_CHI_NHANH',
      flow_id: '00000000-0000-4000-8000-0000000000f1',
      flow_code: 'payroll-timesheet',
      flow_name: 'Đối chiếu bảng lương – chấm công',
      version_no: 3,
      status: 'published',
    },
  ];
}

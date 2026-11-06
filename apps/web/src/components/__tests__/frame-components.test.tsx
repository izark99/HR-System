/**
 * Round A of the UI frame (spec §29.2 AC-UI-63..69): markup and ARIA wiring of the shared layout
 * and pattern components, plus their pure logic (tab keys, field ids, toast timing, focus choice).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, confirmInitialFocus, DialogFooter } from '../Dialog';
import { DataTable } from '../DataTable';
import { EmptyState } from '../EmptyState';
import { FormField, TextInput, fieldIds } from '../FormField';
import { ConclusionCard, KpiCard, KpiRow } from '../KpiCard';
import { MonthPicker } from '../MonthPicker';
import { Select } from '../Select';
import { Stepper, stepState } from '../Stepper';
import { TabPanel, Tabs } from '../Tabs';
import { tabIds, tabKeyTarget } from '../tabs-logic';
import { ToastViewport } from '../Toast';
import {
  AUTO_DISMISS_MS,
  MAX_TOASTS,
  autoDismisses,
  createToastStore,
  toastRole,
} from '../toast-store';
import { PageHeader, PageShell, Section, StickyActionBar, Toolbar } from '../layout';
import { attr, hasId, html, tags } from './render';

describe('PageShell / PageHeader / Section / Toolbar / StickyActionBar (AC-UI-63)', () => {
  it('PageShell renders exactly one <main id="main"> with the page spacing tokens', () => {
    for (const width of ['content', 'fluid', 'narrow'] as const) {
      const m = html(<PageShell width={width}>x</PageShell>);
      expect(m.match(/<main\b/g)).toHaveLength(1);
      const main = tags(m, 'id="main"', 'main')[0]!;
      expect(attr(main, 'class')).toMatch(/px-page-x/);
      expect(attr(main, 'class')).toMatch(/pt-page-top/);
      expect(attr(main, 'class')).toMatch(/gap-section/);
    }
    expect(attr(tags(html(<PageShell>x</PageShell>), 'id="main"')[0]!, 'class')).toMatch(
      /max-w-320/,
    );
    expect(
      attr(tags(html(<PageShell width="narrow">x</PageShell>), 'id="main"')[0]!, 'class'),
    ).toMatch(/max-w-122/);
    const bleed = attr(
      tags(html(<PageShell width="bleed">x</PageShell>), 'id="main"')[0]!,
      'class',
    );
    expect(bleed).not.toMatch(/px-page-x/);
  });

  it('PageHeader: eyebrow + h1 with the variant token + subtitle; back replaces the eyebrow', () => {
    const w = html(<PageHeader eyebrow="Quản trị" title="Người dùng" subtitle="Mô tả" />);
    expect(attr(tags(w, '', 'h1')[0]!, 'class')).toMatch(/text-page-title(?!-)/);
    expect(w).toContain('data-eyebrow');
    expect(w).toContain('Mô tả');
    const s = html(<PageHeader variant="showcase" eyebrow="E" title="T" />);
    expect(attr(tags(s, '', 'h1')[0]!, 'class')).toMatch(/text-page-title-showcase/);
    const b = html(
      <PageHeader eyebrow="E" back={<a href="/">Danh sách flow</a>} title="T" meta="chip" />,
    );
    expect(b).not.toContain('data-eyebrow');
    expect(b).toContain('Danh sách flow');
    expect(b).toContain('chip');
    const one = html(<PageHeader eyebrow="E" title="Tên flow rất dài" oneLineTitle />);
    expect(one).toContain('data-one-line');
  });

  it('Section is named by its heading; plain drops the card', () => {
    const m = html(
      <Section title="Tham số" description="Chọn kỳ" actions={<button type="button">A</button>}>
        body
      </Section>,
    );
    const section = tags(m, '', 'section')[0]!;
    const h2 = tags(m, '', 'h2')[0]!;
    expect(attr(section, 'aria-labelledby')).toBe(attr(h2, 'id'));
    expect(section).toContain('data-card');
    expect(attr(h2, 'class')).toMatch(/text-title-sm/);
    expect(tags(html(<Section title="T" plain />), '', 'section')[0]).not.toContain('data-card');
  });

  it('Toolbar and StickyActionBar lay out both sides', () => {
    expect(html(<Toolbar end="12 dòng">filters</Toolbar>)).toMatch(/filters[\s\S]*12 dòng/);
    const bar = html(
      <StickyActionBar label="Thao tác" note="Ghi chú">
        <button type="button">Chạy</button>
      </StickyActionBar>,
    );
    expect(tags(bar, 'role="region"')[0]).toContain('aria-label="Thao tác"');
    expect(bar).toMatch(/sticky bottom-0/);
  });
});

describe('Tabs (AC-UI-64)', () => {
  it('arrows wrap, Home/End jump, other keys are ignored', () => {
    expect(tabKeyTarget('ArrowRight', 0, 3)).toBe(1);
    expect(tabKeyTarget('ArrowRight', 2, 3)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 3)).toBe(2);
    expect(tabKeyTarget('Home', 2, 3)).toBe(0);
    expect(tabKeyTarget('End', 0, 3)).toBe(2);
    expect(tabKeyTarget('ArrowDown', 0, 3)).toBeNull();
    expect(tabKeyTarget('Enter', 0, 3)).toBeNull();
    expect(tabKeyTarget('ArrowRight', 0, 0)).toBeNull();
  });

  it('skips disabled tabs', () => {
    const disabled = (i: number) => i === 1;
    expect(tabKeyTarget('ArrowRight', 0, 3, disabled)).toBe(2);
    expect(tabKeyTarget('ArrowLeft', 2, 3, disabled)).toBe(0);
    expect(tabKeyTarget('Home', 2, 3, (i) => i === 0)).toBe(1);
    expect(tabKeyTarget('End', 0, 3, (i) => i === 2)).toBe(1);
  });

  const items = [
    { id: 'users', label: 'Tài khoản', count: 1234 },
    { id: 'groups', label: 'Nhóm', count: 3 },
  ];

  it('one Tab stop on the selected tab; aria-controls / aria-labelledby tie tab and panel', () => {
    const m = html(
      <>
        <Tabs id="ug" label="Quản lý" items={items} selected="groups" onChange={() => {}} />
        <TabPanel tabsId="ug" item="groups">
          panel
        </TabPanel>
      </>,
    );
    expect(tags(m, 'role="tablist"')[0]).toContain('aria-label="Quản lý"');
    const tabs = tags(m, 'role="tab"');
    expect(tabs).toHaveLength(2);
    const [users, groups] = tabs as [string, string];
    expect(attr(users, 'aria-selected')).toBe('false');
    expect(attr(users, 'tabindex')).toBe('-1');
    expect(attr(users, 'aria-controls')).toBeUndefined();
    expect(attr(groups, 'aria-selected')).toBe('true');
    expect(attr(groups, 'tabindex')).toBe('0');
    const panel = tags(m, 'role="tabpanel"')[0]!;
    expect(attr(groups, 'aria-controls')).toBe(attr(panel, 'id'));
    expect(attr(panel, 'aria-labelledby')).toBe(attr(groups, 'id'));
    expect(attr(panel, 'tabindex')).toBe('0');
    expect(tabIds('ug', 'groups')).toEqual({ tab: 'ug-tab-groups', panel: 'ug-panel-groups' });
    // Count in the label, Vietnamese number format.
    expect(m).toContain('Tài khoản (1.234)');
  });

  it('panels="all" points every tab at its panel; dense uses 14px text', () => {
    const m = html(
      <Tabs
        id="d"
        label="L"
        items={items}
        selected="users"
        onChange={() => {}}
        panels="all"
        dense
      />,
    );
    for (const tab of tags(m, 'role="tab"')) {
      expect(attr(tab, 'aria-controls')).toMatch(/^d-panel-/);
      expect(attr(tab, 'class')).toMatch(/text-dense/);
    }
  });
});

describe('FormField (AC-UI-66)', () => {
  it('hint before error in aria-describedby; none when absent', () => {
    expect(fieldIds('f', { hint: true, error: true }).describedBy).toBe('f-hint f-error');
    expect(fieldIds('f', { hint: false, error: true }).describedBy).toBe('f-error');
    expect(fieldIds('f', { hint: false, error: false }).describedBy).toBeUndefined();
  });

  it('wires label, hint, error and aria-invalid on a text input', () => {
    const m = html(
      <FormField label="Tên đăng nhập" hint="Chữ thường" error="Đã có người dùng" required>
        {(f) => <TextInput {...f.input} />}
      </FormField>,
    );
    const input = tags(m, '', 'input')[0]!;
    const label = tags(m, '', 'label')[0]!;
    const id = attr(input, 'id')!;
    expect(id).toBeTruthy();
    expect(attr(label, 'for')).toBe(id);
    const described = attr(input, 'aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    for (const d of described) expect(hasId(m, d)).toBe(true);
    expect(m.indexOf(`id="${described[0]}"`)).toBeLessThan(m.indexOf(`id="${described[1]}"`));
    expect(attr(input, 'aria-invalid')).toBe('true');
    expect(attr(input, 'aria-required')).toBe('true');
    expect(m).toContain('Đã có người dùng');
    expect(attr(input, 'class')).toMatch(/h-control/);
  });

  it('no error: no aria-invalid, no error element', () => {
    const m = html(<FormField label="Ghi chú">{(f) => <TextInput {...f.input} />}</FormField>);
    const input = tags(m, '', 'input')[0]!;
    expect(attr(input, 'aria-invalid')).toBeUndefined();
    expect(attr(input, 'aria-describedby')).toBeUndefined();
    expect(m).not.toContain('text-coral-text');
  });

  it('works with Select and MonthPicker (describedBy / invalid / labelledby)', () => {
    const s = html(
      <FormField label="Nhóm" hint="Chọn 1" error="Bắt buộc" id="grp">
        {(f) => (
          <Select
            id={f.id}
            describedBy={f.describedBy}
            invalid={f.invalid}
            value=""
            onChange={() => {}}
            options={[{ value: 'a', label: 'A' }]}
          />
        )}
      </FormField>,
    );
    const trigger = tags(s, 'role="combobox"')[0]!;
    expect(attr(trigger, 'id')).toBe('grp');
    expect(attr(tags(s, '', 'label')[0]!, 'for')).toBe('grp');
    expect(attr(trigger, 'aria-describedby')).toBe('grp-hint grp-error');
    expect(attr(trigger, 'aria-invalid')).toBe('true');

    const p = html(
      <FormField label="Kỳ lương" hint="Tháng" id="kl">
        {(f) => (
          <MonthPicker
            id={f.id}
            labelId={f.labelId}
            describedBy={f.describedBy}
            invalid={f.invalid}
            value="2026-09"
            onChange={() => {}}
          />
        )}
      </FormField>,
    );
    const btn = tags(p, 'id="kl"', 'button')[0]!;
    expect(attr(btn, 'aria-labelledby')).toMatch(/^kl-label /);
    expect(hasId(p, 'kl-label')).toBe(true);
    expect(attr(btn, 'aria-describedby')).toBe('kl-hint');
    expect(attr(btn, 'aria-invalid')).toBeUndefined();
  });

  it('checkbox inline: control before its label; dense uses 14px', () => {
    const m = html(
      <FormField label="Chuẩn hóa" inline dense>
        {(f) => <input type="checkbox" {...f.input} />}
      </FormField>,
    );
    expect(m.indexOf('<input')).toBeLessThan(m.indexOf('<label'));
    expect(attr(tags(m, '', 'label')[0]!, 'class')).toMatch(/text-dense/);
    expect(m).toContain('data-form-field="dense"');
  });
});

describe('Toast (AC-UI-67)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('roles and auto-dismiss by tone', () => {
    expect(toastRole('teal')).toBe('status');
    expect(toastRole('blue')).toBe('status');
    expect(toastRole('coral')).toBe('alert');
    expect(toastRole('amber')).toBe('alert');
    expect(autoDismisses('teal')).toBe(true);
    expect(autoDismisses('coral')).toBe(false);
  });

  it('success closes after 5 seconds; an error stays until closed', () => {
    const store = createToastStore();
    const changes = vi.fn();
    store.subscribe(changes);
    store.show({ tone: 'teal', message: 'Đã lưu' });
    const err = store.show({ tone: 'coral', message: 'Không lưu được' });
    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    expect(store.getSnapshot()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().map((t) => t.tone)).toEqual(['coral']);
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.dismiss(err);
    expect(store.getSnapshot()).toHaveLength(0);
    expect(changes).toHaveBeenCalledTimes(4);
  });

  it('keeps at most 3, dropping the oldest', () => {
    const store = createToastStore();
    for (let i = 1; i <= 5; i++) store.show({ tone: 'coral', message: `e${i}` });
    expect(MAX_TOASTS).toBe(3);
    expect(store.getSnapshot().map((t) => t.message)).toEqual(['e3', 'e4', 'e5']);
  });

  it('hover / focus holds the timer; leaving restarts the full delay', () => {
    const store = createToastStore();
    const id = store.show({ tone: 'blue', message: 'Thông tin' });
    vi.advanceTimersByTime(4000);
    store.pause(id);
    vi.advanceTimersByTime(30_000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.resume(id);
    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('clear() removes everything and no timer fires afterwards', () => {
    const store = createToastStore();
    store.show({ tone: 'teal', message: 'a' });
    store.clear();
    expect(store.getSnapshot()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders each toast with its role and a labelled close button', () => {
    const store = createToastStore();
    store.show({ tone: 'teal', message: 'Đã tạo tài khoản hr.nv07' });
    store.show({ tone: 'coral', message: 'Không khóa được' });
    const m = html(<ToastViewport store={store} />);
    expect(tags(m, 'aria-label="Thông báo"', 'section')).toHaveLength(1);
    expect(tags(m, 'role="status"')).toHaveLength(1);
    expect(tags(m, 'role="alert"')).toHaveLength(1);
    const close = tags(m, 'aria-label="Đóng thông báo"', 'button');
    expect(close).toHaveLength(2);
    expect(attr(close[0]!, 'class')).toMatch(/size-target/);
    expect(m).toContain('hr-toast');
  });
});

describe('Dialog / ConfirmDialog (AC-UI-68)', () => {
  it('danger focuses Cancel first, primary the confirm button', () => {
    expect(confirmInitialFocus('danger')).toBe('cancel');
    expect(confirmInitialFocus('primary')).toBe('confirm');
  });

  const confirm = (tone: 'danger' | 'primary') =>
    html(
      <ConfirmDialog
        open
        tone={tone}
        title="Khóa tài khoản hr.nv07?"
        description="Người này sẽ không đăng nhập được."
        confirmLabel="Khóa"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

  it('title with the object name, description, Cancel then confirm (outer edge)', () => {
    const m = confirm('danger');
    const dialog = tags(m, '', 'dialog')[0]!;
    const h2 = tags(m, '', 'h2')[0]!;
    expect(attr(dialog, 'aria-labelledby')).toBe(attr(h2, 'id'));
    expect(m).toContain('Khóa tài khoản hr.nv07?');
    expect(m).toContain('Người này sẽ không đăng nhập được.');
    const footer = m.slice(m.indexOf('data-dialog-footer'));
    expect(footer.indexOf('>Hủy<')).toBeLessThan(footer.indexOf('>Khóa<'));
  });

  it('marks the initial focus target by tone', () => {
    const danger = tags(confirm('danger'), 'data-autofocus', 'button');
    expect(danger).toHaveLength(1);
    expect(attr(danger[0]!, 'class')).toMatch(/bg-transparent/); // the Cancel text button
    const primary = tags(confirm('primary'), 'data-autofocus', 'button');
    expect(primary).toHaveLength(1);
    expect(attr(primary[0]!, 'class')).toMatch(/bg-teal-strong/);
    expect(attr(tags(confirm('danger'), '', 'button').at(-1)!, 'class')).toMatch(
      /border-coral-text/,
    );
  });

  it('DialogFooter aligns its buttons right', () => {
    expect(html(<DialogFooter>x</DialogFooter>)).toMatch(/justify-end/);
  });
});

describe('DataTable (AC-UI-65)', () => {
  interface Row {
    id: string;
    name: string;
    count: number;
  }
  const rows: Row[] = [
    { id: '1', name: 'hr.nv01', count: 3 },
    { id: '2', name: 'hr.nv02', count: 12 },
  ];
  const base = {
    caption: 'Danh sách tài khoản',
    rowKey: (r: Row) => r.id,
    empty: { title: 'Chưa có tài khoản', text: 'Bấm Tạo tài khoản.' },
    columns: [
      { id: 'name', header: 'Tên', cell: (r: Row) => r.name, rowHeader: true },
      { id: 'count', header: 'Số', cell: (r: Row) => r.count, align: 'right' as const },
    ],
  };

  it('rows in a focusable, labelled scroll region with a hidden caption and pinned actions', () => {
    const m = html(
      <DataTable
        {...base}
        rows={rows}
        rowTone={(r) => (r.count > 10 ? 'amber' : undefined)}
        actions={{ header: 'Thao tác', cell: (r) => <button type="button">{r.name}</button> }}
      />,
    );
    const region = tags(m, 'role="region"')[0]!;
    expect(attr(region, 'tabindex')).toBe('0');
    expect(attr(region, 'aria-label')).toBe('Danh sách tài khoản');
    expect(m).toMatch(/<caption class="sr-only">Danh sách tài khoản<\/caption>/);
    expect(tags(m, 'scope="row"', 'th')).toHaveLength(2);
    const trs = tags(m.slice(m.indexOf('<tbody')), '', 'tr');
    expect(trs).toHaveLength(2);
    for (const tr of trs) expect(attr(tr, 'class')).toMatch(/h-row/);
    expect(attr(trs[1]!, 'class')).toMatch(/bg-amber-tint/);
    const heads = tags(m, 'scope="col"', 'th');
    expect(heads).toHaveLength(3);
    expect(attr(heads[0]!, 'class')).toMatch(/h-target/);
    expect(attr(heads[1]!, 'class')).toMatch(/text-right/);
    expect(attr(heads[2]!, 'class')).toMatch(/sticky right-0/);
    for (const td of tags(m, '', 'td')) expect(attr(td, 'class')).toMatch(/whitespace-nowrap/);
  });

  it('loading shows the table skeleton in a status region', () => {
    const m = html(<DataTable {...base} rows={[]} loading />);
    expect(tags(m, 'role="status"')).toHaveLength(1);
    expect(m).toContain('Đang tải…');
    expect(m).not.toContain('<table');
  });

  it('error shows a coral alert and a retry button', () => {
    const m = html(
      <DataTable {...base} rows={rows} error={{ message: 'Không tải được.', onRetry: () => {} }} />,
    );
    expect(tags(m, 'role="alert"')).toHaveLength(1);
    expect(m).toContain('Không tải được.');
    expect(m).toContain('>Thử lại<');
    expect(m).not.toContain('<table');
  });

  it('empty shows the EmptyState', () => {
    const m = html(<DataTable {...base} rows={[]} />);
    expect(m).toContain('data-empty-state="block"');
    expect(m).toContain('Chưa có tài khoản');
    expect(m).not.toContain('<table');
  });
});

describe('EmptyState, KpiCard, ConclusionCard, Stepper (AC-UI-69)', () => {
  it('EmptyState: icon tile, title, text, at most one action; inline variant is one line', () => {
    const m = html(
      <EmptyState
        title="Chưa có flow"
        text="Nhập flow JSON."
        action={<button type="button">Nhập</button>}
      />,
    );
    expect(m).toMatch(/size-12[^"]*bg-neutral|bg-neutral[^"]*size-12/);
    expect(m).toContain('text-title-xs');
    expect(m).toMatch(/py-12/);
    expect(m.match(/<button/g)).toHaveLength(1);
    const inline = html(<EmptyState variant="inline" title="Không có dòng." />);
    expect(inline).toMatch(/^<p [^>]*data-empty-state="inline"/);
    expect(inline).not.toContain('<svg');
  });

  it('KpiCard: dt/dd in a dl, 4px bar by tone, kpi number in Vietnamese format', () => {
    const m = html(
      <KpiRow label="Số liệu">
        <KpiCard label="Khớp" value={1234} tone="teal" />
        <KpiCard label="Lệch" value={9} tone="coral" hint="vượt ngưỡng" />
      </KpiRow>,
    );
    expect(tags(m, 'aria-label="Số liệu"', 'dl')).toHaveLength(1);
    expect(m).toMatch(/grid-cols-2[^"]*lg:grid-cols-4/);
    expect(m.match(/<dt/g)).toHaveLength(2);
    expect(m).toContain('1.234');
    expect(m).toContain('border-t-teal');
    expect(m).toContain('border-t-coral');
    expect(m).toMatch(/text-kpi text-coral-text/);
    const dd = tags(m, 'aria-describedby', 'dd')[0]!;
    expect(hasId(m, attr(dd, 'aria-describedby')!)).toBe(true);
  });

  it('ConclusionCard: the dark card named by its heading', () => {
    const m = html(<ConclusionCard title="9 nhân viên cần xử lý" text="Chi tiết" />);
    const section = tags(m, '', 'section')[0]!;
    expect(attr(section, 'class')).toMatch(/bg-ink/);
    expect(attr(section, 'aria-labelledby')).toBe(attr(tags(m, '', 'h2')[0]!, 'id'));
  });

  it('Stepper: aria-current on the current step only, done steps announced, mobile labels', () => {
    expect([0, 1, 2].map((i) => stepState(i, 1))).toEqual(['done', 'current', 'todo']);
    const m = html(
      <Stepper
        label="Các bước"
        current={1}
        steps={[
          { id: 'params', label: 'Tham số' },
          { id: 'upload', label: 'Tải file & kiểm tra' },
          { id: 'run', label: 'Chạy' },
          { id: 'result', label: 'Kết quả' },
        ]}
      />,
    );
    expect(tags(m, 'aria-label="Các bước"', 'ol')).toHaveLength(1);
    const items = tags(m, '', 'li');
    expect(items).toHaveLength(4);
    expect(items.filter((li) => attr(li, 'aria-current') === 'step')).toHaveLength(1);
    expect(attr(items[1]!, 'aria-current')).toBe('step');
    expect(m).toContain('(Đã xong)');
    // Only the current label stays visible below 768px.
    expect(m.match(/max-md:sr-only/g)).toHaveLength(3);
    expect(m).toContain('size-7');
  });
});

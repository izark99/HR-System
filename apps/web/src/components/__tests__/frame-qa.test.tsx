/**
 * Independent QA of round A (spec §29.2): edge cases of Tabs, FormField and the toast store that
 * the main component tests do not cover (0 / 1 tab, unknown selection, a toast pushed out while
 * its timer runs, hint + error together on a fixed id).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormField, TextInput } from '../FormField';
import { Tabs } from '../Tabs';
import { tabKeyTarget } from '../tabs-logic';
import { AUTO_DISMISS_MS, createToastStore } from '../toast-store';
import { attr, html, tags } from './render';

describe('Tabs edge cases', () => {
  it('no tab: an empty tab list, no key handled', () => {
    const m = html(<Tabs id="t" label="Trống" items={[]} selected="x" onChange={() => {}} />);
    expect(tags(m, 'role="tablist"')).toHaveLength(1);
    expect(tags(m, 'role="tab"')).toHaveLength(0);
    expect(tabKeyTarget('ArrowRight', 0, 0)).toBeNull();
    expect(tabKeyTarget('Home', 0, 0)).toBeNull();
  });

  it('one tab: arrows, Home and End stay on it; it is the Tab stop', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End'])
      expect(tabKeyTarget(key, 0, 1)).toBe(0);
    const m = html(
      <Tabs
        id="t"
        label="Một"
        items={[{ id: 'a', label: 'A' }]}
        selected="a"
        onChange={() => {}}
      />,
    );
    const [tab] = tags(m, 'role="tab"');
    expect(attr(tab!, 'tabindex')).toBe('0');
    expect(attr(tab!, 'aria-selected')).toBe('true');
  });

  it('all tabs disabled: no key moves', () => {
    expect(tabKeyTarget('ArrowRight', 0, 2, () => true)).toBeNull();
  });

  it('unknown selection falls back to the first tab, which keeps the single Tab stop', () => {
    const m = html(
      <Tabs
        id="t"
        label="Lạ"
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
        selected="gone"
        onChange={() => {}}
      />,
    );
    const stops = tags(m, 'role="tab"').filter((t) => attr(t, 'tabindex') === '0');
    expect(stops).toHaveLength(1);
  });
});

describe('FormField edge cases', () => {
  it('fixed id with hint and error: describedby lists both, ids exist, invalid set', () => {
    const m = html(
      <FormField id="email" label="Tên đăng nhập" hint="Chữ thường" error="Đã tồn tại" required>
        {(f) => <TextInput {...f.input} />}
      </FormField>,
    );
    const [input] = tags(m, 'id="email"', 'input');
    expect(input).toBeDefined();
    expect(attr(input!, 'aria-describedby')).toBe('email-hint email-error');
    expect(attr(input!, 'aria-invalid')).toBe('true');
    expect(attr(input!, 'aria-required')).toBe('true');
    expect(m).toContain('id="email-hint"');
    expect(m).toContain('id="email-error"');
    expect(tags(m, 'for="email"', 'label')).toHaveLength(1);
  });

  it('an empty-string error does not mark the field invalid', () => {
    const m = html(
      <FormField label="Tên" error="">
        {(f) => <TextInput {...f.input} />}
      </FormField>,
    );
    const [input] = tags(m, 'type="text"', 'input');
    expect(attr(input!, 'aria-invalid')).toBeUndefined();
    expect(attr(input!, 'aria-describedby')).toBeUndefined();
  });
});

describe('toast store edge cases', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a toast pushed out stops its timer; the remaining ones still close on time', () => {
    const store = createToastStore();
    const ids = [1, 2, 3, 4, 5].map((i) => store.show({ tone: 'teal', message: `t${i}` }));
    expect(store.getSnapshot().map((t) => t.message)).toEqual(['t3', 't4', 't5']);
    expect(vi.getTimerCount()).toBe(3);
    // Pausing / resuming a dropped toast does nothing (no timer comes back for it).
    store.pause(ids[0]!);
    store.resume(ids[0]!);
    expect(vi.getTimerCount()).toBe(3);
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(store.getSnapshot()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dismissing a paused toast leaves no timer; resume afterwards is a no-op', () => {
    const store = createToastStore();
    const id = store.show({ tone: 'blue', message: 'i' });
    store.pause(id);
    store.dismiss(id);
    store.resume(id);
    expect(store.getSnapshot()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('error / warning toasts never start a timer, even after pause + resume', () => {
    const store = createToastStore();
    const a = store.show({ tone: 'coral', message: 'e' });
    const b = store.show({ tone: 'amber', message: 'w' });
    store.pause(a);
    store.resume(a);
    store.resume(b);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * AUTO_DISMISS_MS);
    expect(store.getSnapshot()).toHaveLength(2);
  });
});

describe('KNOWN BUG', () => {
  // Tabs.tsx: an unknown `selected` falls back to index 0 even when that tab is disabled, so the
  // only Tab stop (tabindex=0) is a disabled button and the tab list cannot be reached by keyboard.
  it.fails('unknown selection with the first tab disabled keeps an enabled Tab stop', () => {
    const m = html(
      <Tabs
        id="t"
        label="Lạ"
        items={[
          { id: 'a', label: 'A', disabled: true },
          { id: 'b', label: 'B' },
        ]}
        selected="gone"
        onChange={() => {}}
      />,
    );
    const stops = tags(m, 'role="tab"').filter(
      (t) => attr(t, 'tabindex') === '0' && attr(t, 'disabled') === undefined,
    );
    expect(stops).toHaveLength(1);
  });
});

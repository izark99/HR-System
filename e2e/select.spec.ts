/**
 * Custom Select (spec §25.3 "Select (dropdown)", MEMORY 2026-10-27 17:50) on the Admin "Gán cho"
 * dropdown: group headers, selection styling, keyboard (arrows, Home/End, Enter, Escape,
 * type-ahead), search above 8 options, ARIA combobox/listbox. Fake accounts only.
 */
import { ADMIN, expect, test, type Page } from './fixtures';
import { parseRgb } from './helpers';
import type { MockUser } from './supabase-mock';

test.use({ signedInAs: ADMIN });

const trigger = (page: Page) => page.getByRole('combobox', { name: 'Gán cho' });
const listbox = (page: Page) => page.getByRole('listbox', { name: 'Gán cho' });

async function open(page: Page) {
  await page.goto('/admin/users');
  await expect(trigger(page)).toBeVisible();
}

test.describe('custom Select', () => {
  test('no native <select> anywhere; trigger looks like an input and opens a grouped listbox', async ({
    page,
  }) => {
    await open(page);
    expect(await page.locator('select, option, optgroup').count()).toBe(0);
    const t = trigger(page);
    await expect(t).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(t).toHaveAttribute('aria-expanded', 'false');
    const box = await t.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(42);
    expect(box!.height).toBeLessThanOrEqual(46);
    await expect(t).toHaveCSS('border-top-left-radius', '12px');
    await expect(t).toHaveCSS('border-top-color', 'rgb(203, 213, 225)');

    await t.click();
    await expect(t).toHaveAttribute('aria-expanded', 'true');
    const list = listbox(page);
    await expect(list.getByRole('group', { name: 'Nhóm' })).toBeVisible();
    await expect(list.getByRole('group', { name: 'Tài khoản' })).toBeVisible();
    await expect(list.getByRole('group', { name: 'Nhóm' }).getByRole('option')).toHaveText(['C&B']);
    await expect(list.getByRole('group', { name: 'Tài khoản' }).getByRole('option')).toHaveText([
      'hr.nv01',
      'admin',
    ]);
    // Group header styled as an eyebrow (12px / 700 / uppercase), not the browser's optgroup.
    const header = list.getByText('Tài khoản', { exact: true });
    await expect(header).toHaveCSS('text-transform', 'uppercase');
    await expect(header).toHaveCSS('font-size', '12px');

    // Mouse: pick a user; the selected option is marked and teal-tinted on reopen.
    await list.getByRole('option', { name: 'hr.nv01' }).click();
    await expect(t).toHaveAttribute('aria-expanded', 'false');
    await expect(t).toContainText('hr.nv01');
    await expect(t).toBeFocused();
    await expect(page.getByRole('region', { name: /^Gán flow/ })).toContainText(
      'Gán flow cho tài khoản "hr.nv01"',
    );
    await t.click();
    const selected = listbox(page).getByRole('option', { selected: true });
    await expect(selected).toHaveText('hr.nv01');
    const [r, g, b] = parseRgb(
      await selected.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    expect([r, g, b]).toEqual([221, 245, 239]); // #DDF5EF
    await expect(selected.locator('svg')).toHaveCount(1); // check mark
    // Outside click closes without a change.
    await page.getByRole('heading', { level: 1 }).click();
    await expect(listbox(page)).toHaveCount(0);
    await expect(t).toContainText('hr.nv01');
  });

  test('keyboard: arrows / Home / End / Enter, Escape keeps the value, type-ahead jumps', async ({
    page,
  }) => {
    await open(page);
    const t = trigger(page);
    await t.focus();
    await page.keyboard.press('ArrowDown'); // opens on the first option
    await expect(listbox(page)).toBeVisible();
    const activeText = async () => {
      const id = await t.getAttribute('aria-activedescendant');
      return (await page.locator(`[id="${id}"]`).textContent())?.trim();
    };
    expect(await activeText()).toBe('C&B');
    await page.keyboard.press('ArrowDown');
    expect(await activeText()).toBe('hr.nv01');
    await page.keyboard.press('End');
    expect(await activeText()).toBe('admin');
    await page.keyboard.press('Home');
    expect(await activeText()).toBe('C&B');
    await page.keyboard.press('ArrowUp'); // stays on the first
    expect(await activeText()).toBe('C&B');
    await page.keyboard.press('Enter');
    await expect(listbox(page)).toHaveCount(0);
    await expect(t).toContainText('C&B');
    await expect(page.getByRole('region', { name: /^Gán flow/ })).toContainText(
      'Gán flow cho nhóm "C&B"',
    );

    // Escape closes without changing the value; focus returns to the trigger.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(listbox(page)).toHaveCount(0);
    await expect(t).toBeFocused();
    await expect(t).toContainText('C&B');

    // Type-ahead on the closed trigger opens on the match; Enter picks it.
    await page.keyboard.type('ad');
    await expect(listbox(page)).toBeVisible();
    expect(await activeText()).toBe('admin');
    await page.keyboard.press('Enter');
    await expect(t).toContainText('admin');
    await expect(t).toHaveAttribute('data-value', `u:${ADMIN.id}`);

    // Tab closes the list and moves on.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(listbox(page)).toHaveCount(0);
  });

  test('more than 8 options: a search box filters (case/accent-insensitive), headers follow', async ({
    page,
    supabase,
  }) => {
    for (let i = 3; i <= 11; i++) {
      const user: MockUser = {
        id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`,
        username: i === 7 ? 'dang.nv07' : `hr.nv${String(i).padStart(2, '0')}`,
        full_name: `Nhân viên Giả ${i}`,
        role: 'user',
        is_active: true,
        must_change_password: false,
        password: 'mat-khau-gia-xx',
      };
      supabase.users.push(user);
    }
    supabase.groups.push({
      id: '00000000-0000-4000-8000-0000000000b9',
      name: 'Đào tạo',
      description: '',
    });
    await open(page);
    const t = trigger(page);
    await t.click();
    const search = page.getByRole('searchbox', { name: 'Tìm trong danh sách' });
    await expect(search).toBeFocused();
    await search.fill('DA');
    // Home/End move the text cursor of the search box, not the active option.
    await page.keyboard.press('Home');
    await expect.poll(() => search.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(0);
    await page.keyboard.press('End');
    await expect.poll(() => search.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(2);
    const list = listbox(page);
    await expect(list.getByRole('option')).toHaveText(['Đào tạo', 'dang.nv07']);
    await expect(list.getByRole('group', { name: 'Nhóm' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(t).toContainText('dang.nv07');
    await t.click();
    await page.getByRole('searchbox', { name: 'Tìm trong danh sách' }).fill('khong-co');
    // The message is a status next to the (empty) listbox, not inside it.
    await expect(
      page.getByRole('status').filter({ hasText: 'Không có mục phù hợp.' }),
    ).toBeVisible();
    await expect(listbox(page).getByText('Không có mục phù hợp.')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(t).toContainText('dang.nv07');
  });
});

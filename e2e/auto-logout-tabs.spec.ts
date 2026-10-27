/**
 * AC-B3-87: two tabs of the same browser have independent idle counters (each tab has its own
 * sessionStorage session); activity in tab A never extends tab B. Fake clock, mocked Supabase.
 */
import { expect, test, USER, type Page } from './fixtures';

const HOME_TITLE = 'Chọn quy trình cần chạy hôm nay';
const warning = (page: Page) => page.getByRole('alertdialog', { name: 'Bạn sắp bị đăng xuất' });

test('activity in tab A does not extend tab B: B warns and signs out, A stays signed in', async ({
  page,
  context,
  supabase,
}) => {
  await page.clock.install();
  const tabB = await context.newPage();
  await supabase.signInAs(tabB, USER);
  await page.goto('/');
  await tabB.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HOME_TITLE);
  await expect(tabB.getByRole('heading', { level: 1 })).toHaveText(HOME_TITLE);

  await page.clock.fastForward('07:00:00');
  await page.mouse.move(120, 120);
  await page.keyboard.press('Shift');
  await page.clock.fastForward('00:55:00');

  await expect(warning(tabB)).toBeVisible();
  await expect(warning(page)).toHaveCount(0);

  await page.clock.fastForward('05:00');
  await expect(tabB).toHaveURL(/\/login\?reason=idle$/);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HOME_TITLE);
});

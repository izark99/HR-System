/**
 * Heavy, opt-in E2E for AC-B3-24 (set HEAVY_E2E=1): a 30-column workbook (15 decimal + 11 text
 * + 4 date columns, fake data) of HEAVY_COLUMNAR_ROWS rows (default 1,000,000) through
 * input.excel → filter → join (branch lookup) → groupBy → output.excel in Chromium. Reports the
 * time and the peak V8 heap of the page and of the engine worker per phase (upload + validation,
 * each running node) and checks that the tab did not crash.
 *
 * The workbook is generated once (streaming ExcelJS writer, fixed seed) into the OS temp dir and
 * reused; HEAVY_COLUMNAR_FILE points to an existing one instead.
 */
import { expect, test, type Page } from './fixtures';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CDPSession } from '@playwright/test';
import {
  perfBranchAoa,
  perfFlow,
  writePerfWorkbook,
} from '../apps/web/src/engine/__tests__/perf-flow';
import { ExcelJS, XLSX } from './helpers';

const HEAVY = !!process.env.HEAVY_E2E;
const ROWS = Number(process.env.HEAVY_COLUMNAR_ROWS ?? 1_000_000);
const DIR = join(tmpdir(), 'hrflow-heavy-columnar');
const DATA = process.env.HEAVY_COLUMNAR_FILE ?? join(DIR, `du_lieu_${ROWS}.xlsx`);
const BRANCHES = join(DIR, 'chi_nhanh.xlsx');

test.skip(!HEAVY, 'heavy E2E: set HEAVY_E2E=1');
test.describe.configure({ timeout: 60 * 60_000 });

/** Streaming writer: the generator itself must not hold a million rows in memory. */
async function generate(): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(BRANCHES)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perfBranchAoa()), 'ChiNhanh');
    writeFileSync(BRANCHES, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
  }
  if (!existsSync(DATA)) await writePerfWorkbook(ExcelJS, DATA, ROWS);
}

/** Samples the V8 heap of the page and of every worker (CDP), tagged with the current phase. */
class HeapSampler {
  phase = 'idle';
  readonly peaks = new Map<string, { page: number; worker: number; since: number; ms: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private workers = new Map<string, string>();
  private nextId = 1;
  private pending = new Map<number, (v: number) => void>();

  constructor(
    private readonly page: Page,
    private readonly pageCdp: CDPSession,
    private readonly browserCdp: CDPSession,
  ) {
    browserCdp.on('Target.receivedMessageFromTarget', (e: { message: string }) => {
      const msg = JSON.parse(e.message) as { id?: number; result?: { usedSize?: number } };
      if (msg.id !== undefined) this.pending.get(msg.id)?.(msg.result?.usedSize ?? 0);
      if (msg.id !== undefined) this.pending.delete(msg.id);
    });
  }

  setPhase(name: string): void {
    const now = Date.now();
    const prev = this.peaks.get(this.phase);
    if (prev) prev.ms = now - prev.since;
    this.phase = name;
    if (!this.peaks.has(name)) this.peaks.set(name, { page: 0, worker: 0, since: now, ms: 0 });
  }

  private async workerHeap(): Promise<number> {
    const { targetInfos } = (await this.browserCdp.send('Target.getTargets')) as {
      targetInfos: { targetId: string; type: string }[];
    };
    let total = 0;
    for (const t of targetInfos.filter((x) => x.type === 'worker')) {
      let session = this.workers.get(t.targetId);
      if (!session) {
        const r = await this.browserCdp.send('Target.attachToTarget', {
          targetId: t.targetId,
          flatten: false,
        });
        session = r.sessionId;
        this.workers.set(t.targetId, session);
      }
      const id = this.nextId++;
      const used = new Promise<number>((done) => {
        this.pending.set(id, done);
        setTimeout(() => done(0), 2000);
      });
      await this.browserCdp
        .send('Target.sendMessageToTarget', {
          sessionId: session,
          message: JSON.stringify({ id, method: 'Runtime.getHeapUsage' }),
        })
        .catch(() => undefined);
      total = Math.max(total, await used);
    }
    return total;
  }

  async sample(): Promise<void> {
    const pageHeap = (
      await this.pageCdp.send('Runtime.getHeapUsage').catch(() => ({ usedSize: 0 }))
    ).usedSize;
    const worker = await this.workerHeap().catch(() => 0);
    const p = this.peaks.get(this.phase);
    if (!p) return;
    p.page = Math.max(p.page, pageHeap);
    p.worker = Math.max(p.worker, worker);
    // Which node is running (progress list), for per-node phases.
    const running = await this.page
      .getByRole('region', { name: 'Đang chạy flow' })
      .getByRole('listitem')
      .filter({ hasText: 'Đang chạy' })
      .first()
      .textContent({ timeout: 200 })
      .catch(() => null);
    if (running && this.phase.startsWith('run')) {
      const label = running.replace(/Đang chạy.*$/s, '').trim();
      if (label && this.phase !== `run: ${label}`) this.setPhase(`run: ${label}`);
    }
  }

  start(): void {
    let busy = false;
    this.timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void this.sample().finally(() => (busy = false));
    }, 500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.setPhase('done');
  }

  report(): string {
    const mb = (n: number) => Math.round(n / 1048576);
    return [...this.peaks]
      .filter(([k]) => k !== 'done' && k !== 'idle')
      .map(
        ([k, v]) => `${k}: ${v.ms} ms, peak heap page ${mb(v.page)} MB, worker ${mb(v.worker)} MB`,
      )
      .join('\n');
  }
}

test.beforeAll(async () => {
  test.setTimeout(60 * 60_000);
  await generate();
});

test(`${ROWS} rows x 30 columns: filter -> join -> groupBy -> output.excel without crashing`, async ({
  page,
  supabase,
  browser,
}) => {
  supabase.setVersions([{ no: 1, from: '2026-01-01', definition: perfFlow() }]);
  const crashed: string[] = [];
  page.on('crash', () => crashed.push('page crashed'));
  page.on('pageerror', (e) => crashed.push(e.message));
  const sampler = new HeapSampler(
    page,
    await page.context().newCDPSession(page),
    await browser.newBrowserCDPSession(),
  );
  sampler.start();

  await page.goto('/run/payroll-timesheet');
  await expect(page.getByLabel(/^Chọn file cho Dữ liệu nhân sự/)).toBeAttached();
  const run = page.getByRole('button', { name: /^(Chạy|Đang)/ }).last();

  sampler.setPhase('upload + read + validate (branch lookup)');
  await page.getByLabel(/^Chọn file cho Danh mục chi nhánh/).setInputFiles(BRANCHES);
  sampler.setPhase(`upload + read + validate (${ROWS} x 30)`);
  await page.getByLabel(/^Chọn file cho Dữ liệu nhân sự/).setInputFiles(DATA);
  await expect(run).toHaveText('Chạy', { timeout: 45 * 60_000 });
  await expect(run).toBeEnabled();

  sampler.setPhase('run');
  await run.click();
  await expect(page).toHaveURL(/\/result$/, { timeout: 45 * 60_000 });
  sampler.setPhase('result screen');
  await expect(page.getByRole('tab', { name: /Tổng hợp/ })).toBeVisible();
  await sampler.sample();
  sampler.stop();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('button', { name: /^Tải Excel/ }).click(),
  ]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await download.path());
  // 5 regions x 50 branches spread over 30 departments: one row per (vung, chi_nhanh, phong_ban).
  expect(wb.worksheets[0]!.actualRowCount).toBeGreaterThan(1);

  console.log(`[heavy columnar E2E] rows=${ROWS}\n${sampler.report()}`);
  expect(crashed).toEqual([]);
});

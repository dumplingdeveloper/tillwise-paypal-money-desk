import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { startSimulator } from '../src/server.js';
import { PROJECT_ROOT, SCREENSHOT_DIR } from '../src/config.js';

type MugState = Record<string, { regular: string; sale: string; to: number | null }>;
function mugState(): MugState {
  const code = `$ids = wc_get_products( array( 'status' => 'publish', 'limit' => -1, 'category' => array( 'mugs' ), 'return' => 'ids', 'orderby' => 'ID', 'order' => 'ASC' ) ); $out = array(); foreach ( $ids as $id ) { $p = wc_get_product( $id ); $to = $p->get_date_on_sale_to(); $out[$p->get_name()] = array( 'regular' => (string) $p->get_regular_price(), 'sale' => (string) $p->get_sale_price(), 'to' => $to ? $to->getTimestamp() : null ); } echo wp_json_encode( $out );`;
  return JSON.parse(execFileSync('docker', ['compose', 'exec', '-T', 'cli', 'wp', 'eval', code, '--allow-root'], { cwd: PROJECT_ROOT, encoding: 'utf8' }));
}
function expectedSundayEnd(): number {
  const code = `$tz = wp_timezone(); $today = new DateTimeImmutable("today", $tz); $sunday = $today->modify("next sunday")->setTime(23,59,59); echo $sunday->getTimestamp();`;
  return Number(execFileSync('docker', ['compose', 'exec', '-T', 'cli', 'wp', 'eval', code, '--allow-root'], { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim());
}

test('browser e2e natural demo script', { timeout: 420000 }, async (t) => {
  if (process.env.BROWSER_E2E !== '1') { t.skip('Set BROWSER_E2E=1 to run real browser and LLM e2e.'); return; }
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const before = mugState();
  const port = Number(process.env.SIM_PORT || 4179);
  const started = await startSimulator('127.0.0.1', port);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 940 } });
    await page.goto(`http://127.0.0.1:${port}/?demo=1`);
    await page.waitForFunction(() => document.documentElement.scrollHeight <= 940 && document.documentElement.scrollWidth <= 1920);
    async function finalCount() { return page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'final').length); }
    async function waitFinalAfter(count: number) {
      await page.waitForFunction((n) => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'final').length > n, count, { timeout: 120000 });
      const finals = await page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string; data: { text?: string; empty?: boolean } }) => e.type === 'final').map((e: { data: { text?: string; empty?: boolean } }) => e.data));
      assert.equal(finals.length, count + 1);
      assert.equal(finals.at(-1)?.empty, false);
      const text = finals.at(-1)?.text || '';
      assert.equal(text.includes('**'), false);
      return text;
    }
    async function say(text: string) { const c = await finalCount(); await page.fill('#text', text); await page.click('#send'); return { c }; }
    async function yes(c: number) { await page.fill('#text', 'yes'); await page.click('#send'); return { c }; }
    async function invokedSkills() {
      return page.evaluate(() => {
        const event = (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'skills_invoked').at(-1);
        const skills = event?.data?.invoked?.skills || event?.data?.invoked || [];
        return Array.isArray(skills) ? skills.map((s: any) => s.name || s.id || s.skillName || s.commandName || s).filter(Boolean) : [];
      });
    }

    let sent = await say("Good morning, how's the shop doing today?");
    await page.waitForSelector('.card:has-text("Daily briefing")', { timeout: 120000 });
    const briefingText = await waitFinalAfter(sent.c);
    assert.match(briefingText, /sales|orders/i);
    assert.match(briefingText, /€/);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'briefing.png'), fullPage: false });

    const previewStartedAt = Date.now();
    sent = await say('Put all mugs 15% off until Sunday.');
    await page.waitForSelector('.card:has-text("Price preview"):has-text("5 prices")', { timeout: 120000 });
    await page.waitForSelector('.card:has-text("Preview valid until")', { timeout: 120000 });
    const previewExpiresAt = await page.evaluate(() => {
      const event = (window as any).__tillwise.events.find((e: { type: string; data: any }) => e.type === 'tool_end' && e.data?.structuredContent?.data?.preview_id);
      return event?.data.structuredContent.data.expires_at || '';
    });
    assert.ok(Math.abs(Date.parse(previewExpiresAt) - (previewStartedAt + 15 * 60 * 1000)) < 2 * 60 * 1000);
    await page.waitForSelector('.confirm:has-text("Apply")', { timeout: 120000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'confirmation.png'), fullPage: false });
    sent = await yes(sent.c);
    assert.equal(await page.inputValue('#text'), '');
    await page.waitForSelector('.card:has-text("Applied price changes")', { timeout: 120000 });
    const appliedText = await waitFinalAfter(sent.c);
    assert.match(appliedText, /15%/);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'applied.png'), fullPage: false });
    const afterApply = mugState();
    const sunday = expectedSundayEnd();
    assert.notDeepEqual(afterApply, before);
    assert.ok(Object.values(afterApply).every((row) => row.sale !== '' && row.to === sunday));

    sent = await say('Actually, undo that.');
    await page.waitForSelector('.confirm:has-text("Undo")', { timeout: 120000 });
    sent = await yes(sent.c);
    await page.waitForSelector('.card:has-text("Undo result")', { timeout: 120000 });
    const undoText = await waitFinalAfter(sent.c);
    assert.match(undoText, /undo|restor|removed/i);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'undo.png'), fullPage: false });
    assert.deepEqual(mugState(), before);

    sent = await say('Put the candles 70% off.');
    await page.waitForSelector('.card:has-text("Price preview"):has-text("No changes: 5 skipped by guardrails")', { timeout: 120000 });
    const guardrailText = await waitFinalAfter(sent.c);
    assert.match(guardrailText, /50|guardrail|limit/i);
    assert.equal(await page.locator('.confirm:not(.hidden)').count(), 0);
    assert.equal(await page.inputValue('#text'), '');
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'guardrail-refusal.png'), fullPage: false });

    sent = await say("What's running low?");
    await page.waitForSelector('.card:has-text("Low stock")', { timeout: 120000 });
    const lowText = await waitFinalAfter(sent.c);
    assert.match(lowText, /low/i);
    assert.match(lowText, /Signature Hoodie|Recycled Notebook|Relax Evening Gift Box|Thank You Gift Box|Midnight Espresso Mug|Stoneware Tea Mug|Citrus Grove Candle|Vanilla Bean Candle/i);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'low-stock.png'), fullPage: false });
    await page.waitForFunction(() => {
      const event = (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'skills_invoked').at(-1);
      const skills = event?.data?.invoked?.skills || [];
      const names = Array.isArray(skills) ? skills.map((s: any) => s.name || s.id || s.skillName || s.commandName || s) : [];
      return names.includes('woocommerce-daily-briefing') && names.includes('woocommerce-safe-price-changes');
    }, null, { timeout: 30000 });
    await page.click('#hoodToggle');
    const controls = await page.locator('.controls').boundingBox();
    const hood = await page.locator('#hoodPane').boundingBox();
    assert.ok(controls && hood && (controls.y + controls.height <= hood.y || hood.y + hood.height <= controls.y || controls.x + controls.width <= hood.x || hood.x + hood.width <= controls.x));
    const roles = await page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'message').map((e: { data: { role?: string } }) => e.data.role));
    assert.ok(roles.join(' ').includes('user assistant'));
    const finalCounts = await page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string; data: { text?: string } }) => e.type === 'final' && e.data.text?.trim()).length);
    assert.equal(finalCounts, 5);
    const timelineSorts = await page.evaluate(() => [...document.querySelectorAll('#timeline li')].map((li) => Number((li as HTMLElement).dataset.sortTime || 0)));
    assert.equal(timelineSorts.every((value, index, values) => index === 0 || values[index - 1] >= value), true);
    assert.deepEqual((await invokedSkills()).sort(), ['woocommerce-daily-briefing', 'woocommerce-safe-price-changes'].sort());
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'hood-open.png'), fullPage: false });
  } finally {
    await browser.close().catch(() => {});
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
    await started.runtime.stop();
  }
});

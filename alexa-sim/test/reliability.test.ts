import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startSimulator } from '../src/server.js';
import { PROJECT_ROOT, SCREENSHOT_DIR } from '../src/config.js';

test('LIVE natural demo reliability three runs', { timeout: 900000 }, async (t) => {
  if (process.env.RELIABILITY_E2E !== '1') { t.skip('Set RELIABILITY_E2E=1 to run three live natural demo runs.'); return; }
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const port = Number(process.env.SIM_PORT || 4178);
  const started = await startSimulator('127.0.0.1', port);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const rows: string[] = ['run,step,latency_ms,score,finals_per_turn,skills_invoked,final_text'];
  try {
    for (let run = 1; run <= 3; run++) {
      execFileSync('./scripts/demo-reset.sh', { cwd: PROJECT_ROOT, stdio: 'ignore' });
      const page = await browser.newPage({ viewport: { width: 1920, height: 940 } });
      await page.goto(`http://127.0.0.1:${port}/?demo=1`);
      async function finalCount() { return page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'final').length); }
      async function finalAfter(count: number) {
        await page.waitForFunction((n) => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'final').length > n, count, { timeout: 120000 });
        const finals = await page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string; data: { text?: string; empty?: boolean } }) => e.type === 'final').map((e: { data: { text?: string; empty?: boolean } }) => e.data));
        assert.equal(finals.length, count + 1);
        assert.equal(finals.at(-1)?.empty, false);
        const text = finals.at(-1)?.text || '';
        assert.equal(text.includes('**'), false);
        assert.notEqual(text.trim(), '');
        return { text, count: finals.length - count };
      }
      function assertRelevant(name: string, text: string) {
        if (name === 'briefing') { assert.match(text, /sales|orders/i); assert.match(text, /€/); }
        if (name === 'mugs-sale-confirm-apply') assert.match(text, /15%/);
        if (name === 'undo-confirm') assert.match(text, /undo|restor|removed/i);
        if (name === 'guardrail-refusal') assert.match(text, /50%/);
        if (name === 'low-stock') { assert.match(text, /low/i); assert.match(text, /Signature Hoodie|Recycled Notebook|Relax Evening Gift Box|Thank You Gift Box|Midnight Espresso Mug|Stoneware Tea Mug|Citrus Grove Candle|Vanilla Bean Candle/i); }
      }
      async function invokedSkills() {
        await page.waitForTimeout(500);
        return page.evaluate(() => {
          const event = (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'skills_invoked').at(-1);
          const skills = event?.data?.invoked?.skills || event?.data?.invoked || [];
          return Array.isArray(skills) ? skills.map((s: any) => s.name || s.id || s.skillName || s.commandName || s).filter(Boolean).join('|') : '';
        });
      }
      async function step(name: string, prompt: string, wait: () => Promise<unknown>, confirm = false) {
        const startedAt = Date.now();
        const finals = await finalCount();
        await page.fill('#text', prompt); await page.click('#send');
        if (confirm) { await page.waitForSelector('.confirm:not(.hidden)', { timeout: 120000 }); await page.fill('#text', 'yes'); await page.click('#send'); }
        await wait();
        const final = await finalAfter(finals);
        const finalText = final.text;
        assertRelevant(name, finalText);
        const skills = await invokedSkills();
        const latency = Date.now() - startedAt;
        rows.push(`${run},${name},${latency},pass,${final.count},"${skills}","${finalText.replace(/"/g, '""')}"`);
        console.log(`RELIABILITY run=${run} step=${name} latency_ms=${latency} score=pass finals=${final.count} skills="${skills}" final="${finalText}"`);
      }
      await step('briefing', "Good morning, how's the shop doing today?", () => page.waitForSelector('.card:has-text("Daily briefing")', { timeout: 120000 }));
      await step('mugs-sale-confirm-apply', 'Put all mugs 15% off until Sunday.', () => page.waitForSelector('.card:has-text("Applied price changes")', { timeout: 120000 }), true);
      await step('undo-confirm', 'Actually, undo that.', () => page.waitForSelector('.card:has-text("Undo result")', { timeout: 120000 }), true);
      await step('guardrail-refusal', 'Put the candles 70% off.', async () => { await page.waitForSelector('.card:has-text("Price preview"):has-text("No changes: 5 skipped by guardrails")', { timeout: 120000 }); assert.equal(await page.locator('.confirm:not(.hidden)').count(), 0); });
      await step('low-stock', "What's running low?", () => page.waitForSelector('.card:has-text("Low stock")', { timeout: 120000 }));
      const allSkills = await invokedSkills();
      assert.match(allSkills, /woocommerce-daily-briefing/);
      assert.match(allSkills, /woocommerce-safe-price-changes/);
      await page.close();
    }
    console.log('RELIABILITY_TABLE\n' + rows.join('\n'));
  } finally {
    await browser.close().catch(() => {});
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
    await Promise.race([started.runtime.stop(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
});

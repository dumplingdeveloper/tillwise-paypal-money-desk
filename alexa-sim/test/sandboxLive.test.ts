import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { startSimulator } from '../src/server.js';
import { PROJECT_ROOT, SCREENSHOT_DIR } from '../src/config.js';
import { openMoneyDesk } from './moneyDeskHarness.js';

/**
 * LIVE PAYPAL SANDBOX acceptance test (opt-in: LIVE_PAYPAL=1). Real money movement in the PayPal sandbox:
 *   1. pick a Woo demo order (≤ €100 refund cap) and link it to a REAL sandbox card capture (npm run sandbox:seed -- --link-woo N);
 *   2. voice flow: "Refund order N." → preview → "Yes, go ahead." → host confirms → paypal_refund_apply on api-m.sandbox.paypal.com;
 *   3. assert STATE, not DOM: the refund as PayPal itself reports it (GET /v2/payments/refunds/{id}), the WP audit row and order
 *      meta, the voice badge API, and the Money Desk's Studio getState() + ledger (live sandbox_activity row, "· mock data" titles).
 * Needs: ~/.config/tillwise/paypal-sandbox.env, the MCP server on MCP_URL started with PAYPAL_MODE=sandbox and mcp-server/.env,
 * the tillwise-paypal Docker stack, Chrome, and a Copilot login with EXPECTED_GITHUB_LOGIN set (or BYOK). Uses about 4 voice-model calls.
 */
const VOICE_MODEL_EVENTS = join(PROJECT_ROOT, 'alexa-sim', '.copilot-sdk-state', '.state', 'events.jsonl');
const SANDBOX_SHOTS = join(SCREENSHOT_DIR, 'sandbox');
const EVIDENCE = join(PROJECT_ROOT, 'docs', 'evidence', 'paypal-sandbox-voice-refund.json');

function wpEval<T>(code: string): T {
  return JSON.parse(execFileSync('docker', ['compose', 'exec', '-T', 'cli', 'wp', 'eval', code, '--allow-root'], { cwd: PROJECT_ROOT, encoding: 'utf8' }));
}
function orderState(id: number) {
  return wpEval<{ total: string; currency: string; status: string; capture: string; refunds: string[] }>(`$o = wc_get_order(${id}); echo wp_json_encode(array('total' => $o->get_total(), 'currency' => $o->get_currency(), 'status' => $o->get_status(), 'capture' => (string) $o->get_meta('_tillwise_paypal_capture_id'), 'refunds' => array_values(array_filter((array) $o->get_meta('_tillwise_paypal_refund_ids')))));`);
}
function pickOrder(): number {
  if (process.env.LIVE_PAYPAL_ORDER) return Number(process.env.LIVE_PAYPAL_ORDER);
  // The newest completed demo order that fits the €100 refund cap and has not been refunded yet.
  return wpEval<number>(`$ids = wc_get_orders(array('limit' => 20, 'status' => array('completed'), 'meta_key' => '_tillwise_seed_order', 'meta_value' => '1', 'orderby' => 'date', 'order' => 'DESC', 'return' => 'ids')); $pick = 0; foreach ($ids as $id) { $o = wc_get_order($id); if ((float) $o->get_total() <= 100 && !$o->get_meta('_tillwise_paypal_refund_ids')) { $pick = $id; break; } } echo wp_json_encode($pick);`);
}
function modelCallsSince(startIso: string): Record<string, number> {
  if (!existsSync(VOICE_MODEL_EVENTS)) return {};
  const counts: Record<string, number> = {};
  for (const line of readFileSync(VOICE_MODEL_EVENTS, 'utf8').split('\n')) {
    if (!line.includes('"assistant.message"')) continue;
    try {
      const row = JSON.parse(line) as { type: string; timestamp?: string; data?: { model?: string } };
      if (row.type !== 'assistant.message' || !row.timestamp || row.timestamp < startIso) continue;
      const model = row.data?.model || 'unknown';
      counts[model] = (counts[model] || 0) + 1;
    } catch { /* partial line */ }
  }
  return counts;
}

test('LIVE PayPal sandbox: voice refund of a real sandbox capture, audited, and shown live on the Money Desk', { timeout: 600000 }, async (t) => {
  if (process.env.LIVE_PAYPAL !== '1') { t.skip('Set LIVE_PAYPAL=1 (real PayPal sandbox + Copilot model) to run.'); return; }
  const startedIso = new Date().toISOString();
  assert.ok(process.env.EXPECTED_GITHUB_LOGIN || process.env.ALLOW_ANY_GITHUB_LOGIN === '1', 'set EXPECTED_GITHUB_LOGIN=<your Copilot login> (checked before any PayPal call)');
  mkdirSync(SANDBOX_SHOTS, { recursive: true });
  const orderId = pickOrder();
  assert.ok(orderId > 0, 'no completed demo order ≤ €100 without a refund: run scripts/demo-reset.sh');

  // 1. Link the order to a real sandbox capture for exactly its total.
  const seed = execFileSync(process.execPath, [join(PROJECT_ROOT, 'mcp-server', 'dist', 'src', 'sandboxSeed.js'), '--link-woo', String(orderId)], { cwd: join(PROJECT_ROOT, 'mcp-server'), encoding: 'utf8', env: { ...process.env, TILLWISE_PAYPAL_CALL_SOURCE: 'live-test:seed-link' } });
  console.log(seed.split('\n').filter((l) => /link Woo order|capture for Woo order|Summary/.test(l)).join('\n'));
  const before = orderState(orderId);
  assert.match(before.capture, /^[0-9A-Z]{17}$/, 'a real 17-character PayPal capture id, not MOCKCAPTURE');
  assert.deepEqual(before.refunds, []);
  assert.equal(before.currency, 'EUR');

  const port = Number(process.env.SIM_PORT || 4189);
  const baseUrl = `http://127.0.0.1:${port}`;
  const started = await startSimulator('127.0.0.1', port);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // The badge API says REAL sandbox and names the credentials' app.
    const mode = await (await fetch(`${baseUrl}/api/paypal-mode`)).json() as { mode: string; label: string; ledger: string };
    assert.equal(mode.mode, 'sandbox');
    assert.match(mode.label, /^PayPal: REAL sandbox · api-m\.sandbox\.paypal\.com · /);

    // 2. Voice flow.
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${baseUrl}/?demo=1`);
    await page.waitForSelector('#text');
    const finals = () => page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'final').length);
    const waitFinal = async (n: number) => { await page.waitForFunction((c) => (window as any).__tillwise.events.filter((e: { type: string }) => e.type === 'final').length > c, n, { timeout: 150000 }); };
    const say = async (text: string) => { const n = await finals(); await page.fill('#text', text); await page.click('#send'); await waitFinal(n); };
    await say(`Refund order ${orderId}.`);
    const preview = await page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string; data: any }) => e.type === 'tool_end' && e.data?.structuredContent?.data?.preview_id && e.data?.structuredContent?.data?.capture_id).map((e: { data: any }) => e.data.structuredContent.data).at(-1));
    assert.equal(preview?.capture_id, before.capture, 'the preview names the real sandbox capture');
    assert.equal(Number(preview?.amount), Number(before.total));
    const n = await finals();
    await page.fill('#text', 'Yes, go ahead.');
    await page.click('#send');
    await page.locator('.confirm:not(.hidden)').waitFor({ state: 'visible', timeout: 150000 });
    await page.screenshot({ path: join(SANDBOX_SHOTS, 'voice-refund-confirm.png') });
    await page.fill('#text', 'yes');
    await page.click('#send');
    await page.waitForFunction(() => (window as any).__tillwise.events.some((e: { type: string; data: any }) => e.type === 'tool_end' && e.data?.structuredContent?.data?.refund?.id), null, { timeout: 150000 });
    await waitFinal(n + 1).catch(() => {});
    await page.screenshot({ path: join(SANDBOX_SHOTS, 'voice-refund-done.png') });
    const applied = await page.evaluate(() => (window as any).__tillwise.events.filter((e: { type: string; data: any }) => e.type === 'tool_end' && e.data?.structuredContent?.data?.refund?.id).map((e: { data: any }) => e.data.structuredContent.data.refund).at(-1));
    const refundId = String(applied?.id || '');
    assert.match(refundId, /^[0-9A-Z]{17}$/, 'a real PayPal refund id');

    // 3a. PayPal's own record of the refund (the source of truth), read with the same sandbox credentials.
    const mcpDist = join(PROJECT_ROOT, 'mcp-server', 'dist', 'src');
    // Count this process's own PayPal calls too (TILLWISE_PAYPAL_CALL_LOG, mcp-server/src/paypal/callLog.ts).
    const { installPayPalCallLog } = await import(pathToFileURL(join(mcpDist, 'paypal', 'callLog.js')).href) as { installPayPalCallLog: (o: { source: string }) => void };
    installPayPalCallLog({ source: 'live-test' });
    const { SandboxRest } = await import(pathToFileURL(join(mcpDist, 'sandboxSeed.js')).href) as { SandboxRest: new (o: { clientId: string; clientSecret: string }) => { call<T>(method: string, path: string): Promise<{ json: T }> } };
    const { readSandboxCredentials } = await import(pathToFileURL(join(mcpDist, 'paypal', 'liveClient.js')).href) as { readSandboxCredentials: () => { clientId: string; clientSecret: string } | null };
    const api = new SandboxRest(readSandboxCredentials()!);
    const { json: paypalRefund } = await api.call<{ id: string; status: string; amount: { currency_code: string; value: string }; links?: Array<{ rel: string; href: string }> }>('GET', `/v2/payments/refunds/${refundId}`);
    assert.equal(paypalRefund.status, 'COMPLETED');
    assert.deepEqual(paypalRefund.amount, { currency_code: 'EUR', value: Number(before.total).toFixed(2) });
    assert.ok(paypalRefund.links?.some((l) => l.rel === 'up' && l.href.endsWith(`/v2/payments/captures/${before.capture}`)), 'PayPal links the refund to our capture');

    // 3b. WP: audit row + order meta.
    const after = orderState(orderId);
    assert.deepEqual(after.refunds, [refundId]);
    const briefing = await started.paypalRead.callReadOnly('paypal_money_briefing');
    // The WP audit row (class-store-agent.php paypal_audit_record) keeps the refund id as paypal_object_id.
    const audit = ((briefing.data as { audit?: Array<Record<string, unknown>> }).audit || []).find((row) => row.paypal_object_id === refundId);
    assert.equal(audit?.tool, 'paypal_refund_apply');
    assert.equal(Number(audit?.woo_order_id), orderId);
    assert.equal(audit?.status, 'COMPLETED');
    assert.equal(Number(audit?.amount), Number(before.total));

    // 3c. Money Desk: the live sandbox grid holds the new refund; every mock widget says so in its title.
    const desk = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await openMoneyDesk(desk, baseUrl);
    const deskState = await desk.evaluate(() => { const md = (window as any).__moneyDesk; const state = md.studioApi.getState(); const pageState = state.pages.find((p: any) => p.id === state.selectedPageId); return { paypalMode: md.ledger.paypal_mode, ledgerMode: md.ledger.mode, app: md.ledger.sandbox_app, activity: md.ledger.sandbox_activity, titles: Object.fromEntries(Object.entries(pageState.widgets).map(([id, w]: [string, any]) => [id, w.format?.title?.text])), layout: pageState.widgetLayout['sandbox-activity'], cols: pageState.widgets['sandbox-activity']?.dataMapping?.cols?.map((c: any) => c.id), sort: pageState.widgets['sandbox-activity']?.sort, errors: md.errors }; });
    assert.equal(deskState.paypalMode, 'sandbox');
    assert.equal(deskState.ledgerMode, 'mock');
    assert.deepEqual(deskState.errors, []);
    assert.deepEqual(deskState.layout, { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 14 });
    assert.ok(deskState.cols.includes('sandbox_activity.paypal_id'));
    assert.deepEqual(deskState.sort, [{ field: { id: 'sandbox_activity.created_at' }, direction: 'desc' }], 'newest live PayPal object first');
    assert.equal(deskState.titles['sandbox-activity'], 'LIVE PayPal sandbox · objects Tillwise created');
    for (const [id, text] of Object.entries(deskState.titles)) if (id !== 'sandbox-activity') assert.match(String(text), / · mock data$/, `${id} names its mock source`);
    const row = deskState.activity.find((r: Record<string, unknown>) => r.paypal_id === refundId);
    assert.deepEqual({ kind: row?.kind, order: row?.order_id, amount: row?.amount, status: row?.status }, { kind: 'refund', order: orderId, amount: Number(before.total), status: 'COMPLETED' });
    await desk.screenshot({ path: join(SANDBOX_SHOTS, 'money-desk-sandbox.png') });

    const calls = modelCallsSince(startedIso);
    console.log(`LIVE_PAYPAL order=${orderId} capture=${before.capture} refund=${refundId} paypal_status=${paypalRefund.status} model_calls=${JSON.stringify(calls)}`);
    mkdirSync(join(PROJECT_ROOT, 'docs', 'evidence'), { recursive: true });
    writeFileSync(EVIDENCE, `${JSON.stringify({ generatedBy: 'alexa-sim/test/sandboxLive.test.ts', at: new Date().toISOString(), host: 'api-m.sandbox.paypal.com', credentials: deskState.app?.label || null, woo_order_id: orderId, order_total: before.total, currency: before.currency, paypal_capture_id: before.capture, paypal_refund_id: refundId, paypal_refund_status: paypalRefund.status, paypal_refund_amount: paypalRefund.amount, audit: { tool: audit?.tool, status: audit?.status, paypal_object_id: audit?.paypal_object_id, woo_order_id: audit?.woo_order_id }, money_desk: { paypal_mode: deskState.paypalMode, ledger_mode: deskState.ledgerMode, sandbox_activity_rows: deskState.activity.length }, model_calls: calls }, null, 2)}\n`);
  } finally {
    await browser.close().catch(() => {});
    await started.studioBridge.close();
    await started.paypalRead.close();
    await started.runtime.stop().catch(() => {});
    started.server.closeAllConnections();
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
  }
});

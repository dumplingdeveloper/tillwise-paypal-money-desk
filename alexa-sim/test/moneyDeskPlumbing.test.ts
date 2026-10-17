import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startSimulator } from '../src/server.js';
import type { SessionFactory } from '../src/studioBridge.js';
import { askStudioPanel, canvasHasText, canvasWidgetCount, noOverlaysOverStudio, openMoneyDesk } from './moneyDeskHarness.js';

/**
 * OFFLINE PLUMBING TEST — NOT EVIDENCE. A scripted fake replaces the Copilot SDK session so we can check the
 * browser half (AG Studio clientToolRunner → NDJSON → Studio executes add_widget / configure_grid → results
 * fed back) without spending model turns. The live acceptance test is moneyDeskLive.test.ts (LIVE_LLM=1).
 * Needs Chrome and the MCP server on MCP_URL (default 127.0.0.1:3338). Run with MONEY_DESK_E2E=1.
 */
const scriptedFakeModel: SessionFactory = async ({ invoke, onEvent }) => ({
  send: async () => {
    void (async () => {
      try {
      onEvent({ type: 'text_delta', messageId: 'fake-1', delta: '[offline scripted fake] adding a grid.' });
      const added = await invoke('add_widget', { widgetId: 'plumbing-grid', type: 'grid', xTrack: 0, yTrack: 46, xSpan: 24, ySpan: 12 }, 'fake-call-1');
      const configured = await invoke('configure_grid', { op: 'patch', widgetId: 'plumbing-grid', value: { type: 'grid', dataMapping: { cols: [{ id: 'invoices.customer' }, { id: 'invoices.amount_due' }] }, format: { title: { enabled: true, text: 'Plumbing check grid' } } } }, 'fake-call-2');
      onEvent({ type: 'text_delta', messageId: 'fake-2', delta: `[offline scripted fake] results: ${added.slice(0, 80)} | ${configured.slice(0, 80)}` });
      onEvent({ type: 'idle' });
      } catch (error) { onEvent({ type: 'error', message: (error as Error).message }); }
    })();
    return 'fake';
  },
  abort: async () => {},
  disconnect: async () => {},
});

test('offline plumbing: AI panel → client tool runner → bridge → Studio executes tool calls', { timeout: 180000 }, async (t) => {
  if (process.env.MONEY_DESK_E2E !== '1') { t.skip('Set MONEY_DESK_E2E=1 (needs Chrome + MCP server) to run the offline Money Desk plumbing test.'); return; }
  const port = Number(process.env.SIM_PORT || 4191);
  const baseUrl = `http://127.0.0.1:${port}`;
  const { server, studioBridge, paypalRead } = await startSimulator('127.0.0.1', port, { studioSessionFactory: scriptedFakeModel, skipRuntimeStart: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await openMoneyDesk(page, baseUrl);
    assert.deepEqual(await page.evaluate(() => (window as any).__moneyDesk.errors), []);
    assert.deepEqual(await noOverlaysOverStudio(page), []);
    const canvasBefore = await canvasWidgetCount(page);
    assert.equal(canvasBefore, 7);
    const result = await askStudioPanel(page, baseUrl, 'Plumbing check: who still owes us?', 60000);
    assert.deepEqual(Object.keys(result.added), ['plumbing-grid']);
    assert.equal(result.added['plumbing-grid'].type, 'grid');
    assert.deepEqual(result.added['plumbing-grid'].dataMapping?.cols.map((c) => c.id), ['invoices.customer', 'invoices.amount_due']);
    assert.equal(await canvasWidgetCount(page), canvasBefore + 1);
    assert.equal(await canvasHasText(page, 'Plumbing check grid'), true);
    const kinds = result.turnEvents.map((e) => `${e.kind}${e.name ? `:${e.name}` : ''}`);
    assert.deepEqual(kinds.filter((k) => k.startsWith('TOOL_CALL_EMITTED') || k.startsWith('STUDIO_TOOL_RESULT')), ['TOOL_CALL_EMITTED:add_widget', 'STUDIO_TOOL_RESULT:add_widget', 'TOOL_CALL_EMITTED:configure_grid', 'STUDIO_TOOL_RESULT:configure_grid']);
    const studioResults = result.turnEvents.filter((e) => e.kind === 'STUDIO_TOOL_RESULT').map((e) => String(e.result));
    assert.equal(studioResults.some((r) => /error/i.test(r)), false, `Studio tool results: ${studioResults.join(' || ')}`);
  } finally {
    await browser.close();
    await studioBridge.close();
    await paypalRead.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

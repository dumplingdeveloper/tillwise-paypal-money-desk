import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startSimulator } from '../src/server.js';
import type { SessionFactory } from '../src/studioBridge.js';
import { askStudioPanel, canvasGeometry, canvasHasText, canvasWidgetCount, noOverlaysOverStudio, openMoneyDesk } from './moneyDeskHarness.js';

/**
 * OFFLINE PLUMBING TEST — NOT EVIDENCE. A scripted fake replaces the Copilot SDK session so we can check the
 * browser half (AG Studio clientToolRunner → NDJSON → Studio executes place_widget / configure_* → results
 * fed back) without spending model turns. The live acceptance test is moneyDeskLive.test.ts (LIVE_LLM=1).
 * Needs Chrome and the MCP server on MCP_URL (default 127.0.0.1:3338). Run with MONEY_DESK_E2E=1.
 */
let promptsSeen: string[] = [];
const title = (text: string) => ({ title: { enabled: true, text } });
const scriptedFakeModel: SessionFactory = async ({ invoke, onEvent }) => ({
  send: async (prompt: string) => {
    promptsSeen.push(prompt);
    void (async () => {
      try {
      onEvent({ type: 'text_delta', messageId: 'fake-1', delta: '[offline scripted fake] placing widgets.' });
      const results: string[] = [];
      results.push(await invoke('place_widget', { widgetId: 'plumbing-chart', type: 'column-chart-grouped' }, 'fake-call-1'));
      results.push(await invoke('configure_column_chart_grouped', { op: 'patch', widgetId: 'plumbing-chart', value: { type: 'column-chart-grouped', dataMapping: { categoryKey: [{ id: 'captures.segment' }], valueKey: [{ id: 'captures.gross', aggregation: 'sum' }] }, format: title('PayPal Revenue by Customer Segment (This Month)') } }, 'fake-call-2'));
      results.push(await invoke('place_widget', { widgetId: 'plumbing-week-tile', type: 'refund-rate-tile' }, 'fake-call-3'));
      results.push(await invoke('configure_refund_rate_tile', { op: 'patch', widgetId: 'plumbing-week-tile', value: { type: 'refund-rate-tile', dataMapping: { refundAmount: [{ id: 'refunds.amount', aggregation: 'sum' }], refundDate: [{ id: 'refunds.date' }], capturedAmount: [{ id: 'captures.gross', aggregation: 'sum' }], captureDate: [{ id: 'captures.date' }] }, format: { ...title('Refund Rate (This Calendar Week)'), window: 'calendar-week' } } }, 'fake-call-4'));
      results.push(await invoke('place_widget', { widgetId: 'plumbing-kpi', type: 'value', size: 'standard' }, 'fake-call-5'));
      results.push(await invoke('configure_value', { op: 'patch', widgetId: 'plumbing-kpi', value: { type: 'value', dataMapping: { value: [{ id: 'invoices.amount_due', aggregation: 'sum' }] }, format: title('Outstanding on invoices') } }, 'fake-call-6'));
      results.push(await invoke('place_widget', { widgetId: 'plumbing-grid', type: 'grid' }, 'fake-call-7'));
      results.push(await invoke('configure_grid', { op: 'patch', widgetId: 'plumbing-grid', value: { type: 'grid', dataMapping: { cols: [{ id: 'invoices.customer' }, { id: 'invoices.invoice_number' }, { id: 'invoices.status' }, { id: 'invoices.due_date' }, { id: 'invoices.days_overdue' }, { id: 'invoices.amount_due' }] }, format: title('Plumbing check grid') } }, 'fake-call-8'));
      results.push(await invoke('add_widget_filter', { op: 'append', widgetId: 'plumbing-grid', value: { field: { id: 'invoices.amount_due' }, model: { operator: 'greaterThan', value: 0 } } }, 'fake-call-9'));
      // Refund drill-down shape: one column per day (date bucket field id ::day), stacked by reason, last 14 days.
      results.push(await invoke('place_widget', { widgetId: 'plumbing-daily', type: 'column-chart-stacked' }, 'fake-call-10'));
      results.push(await invoke('configure_column_chart_stacked', { op: 'patch', widgetId: 'plumbing-daily', value: { type: 'column-chart-stacked', dataMapping: { categoryKey: [{ id: 'refunds.date::day' }], valueKey: [{ id: 'refunds.amount', aggregation: 'sum' }], legendKey: [{ id: 'refunds.reason' }] }, format: title('Refunds per day by reason · last 14 days') } }, 'fake-call-11'));
      results.push(await invoke('add_widget_filter', { op: 'append', widgetId: 'plumbing-daily', value: { field: { id: 'refunds.date' }, model: { operator: 'inRelativeRange', value: { type: 'last', value: 14, unit: 'day', includeToday: true } } } }, 'fake-call-12'));
      onEvent({ type: 'text_delta', messageId: 'fake-2', delta: `[offline scripted fake] results: ${results.map((r) => r.slice(0, 60)).join(' | ')}` });
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
    const seeded = await canvasGeometry(page);
    for (const frame of seeded.frames) {
      assert.equal(frame.titleTruncated, false, `seeded title cut off: ${frame.title}`);
      assert.equal(frame.gridOverflowX, false, `seeded grid columns overflow: ${frame.title}`);
      assert.deepEqual(frame.truncatedCells, [], `seeded cells cut off in ${frame.title}`);
    }
    const windows = await page.evaluate(() => (window as any).__moneyDesk.refundWindows());
    const anomaly = (await paypalRead.callReadOnly('paypal_refund_anomaly', { window_days: 7 })).data as { window: { end: string; label: string }; calendar_week: { label: string; same_dates_as_window: boolean } };
    promptsSeen = [];
    const result = await askStudioPanel(page, baseUrl, 'Plumbing check: who still owes us?', 60000);
    if (process.env.PLUMBING_SHOT) { await page.waitForTimeout(1500); await page.screenshot({ path: process.env.PLUMBING_SHOT, fullPage: true }); }
    // The agent is told what is already on the canvas (the de-duplication context).
    assert.match(promptsSeen[0], /- refund-rate \[refund-rate-tile\] "Refund rate · last 7 days": .*window=rolling last 7 days/);
    assert.match(promptsSeen[0], /- refunds-grid \[grid\] "PayPal refunds": cols=refunds\.date\+refunds\.customer/);
    // The page's refund windows (from the rows Studio holds) agree with the read-only MCP tool, and the agent sees the
    // exact dates; when the calendar week equals the seeded rolling 7 days (a Sunday), it is told a tile would repeat it.
    assert.equal(windows.lastDataDay, anomaly.window.end);
    assert.equal(windows.calendarWeek.dates, anomaly.calendar_week.label);
    assert.equal(windows.tiles.find((t: { id: string }) => t.id === 'refund-rate').dates, anomaly.window.label);
    assert.equal(windows.tiles.find((t: { id: string }) => t.id === 'refund-rate').sameDatesAsCalendarWeek, anomaly.calendar_week.same_dates_as_window);
    assert.ok(promptsSeen[0].includes(`window=rolling last 7 days = ${anomaly.window.label}`), 'the seeded tile line carries its exact dates');
    assert.ok(promptsSeen[0].includes(`the calendar week (Monday to the last data day) is ${anomaly.calendar_week.label}.`), 'the calendar week dates are in the request context');
    assert.equal(promptsSeen[0].includes('already covers exactly these dates'), anomaly.calendar_week.same_dates_as_window);
    assert.deepEqual(Object.keys(result.added).sort(), ['plumbing-chart', 'plumbing-daily', 'plumbing-grid', 'plumbing-kpi', 'plumbing-week-tile']);
    const added = result.added;
    assert.equal(added['plumbing-grid'].type, 'grid');
    assert.deepEqual(added['plumbing-grid'].dataMapping?.cols.map((c) => c.id), ['invoices.customer', 'invoices.invoice_number', 'invoices.status', 'invoices.due_date', 'invoices.days_overdue', 'invoices.amount_due']);
    assert.deepEqual(added['plumbing-grid'].widgetFilters, [{ field: { id: 'invoices.amount_due' }, model: { operator: 'greaterThan', value: 0 } }]);
    assert.equal(added['plumbing-week-tile'].format?.window, 'calendar-week');
    // Placement comes from TillwiseLayout.planPlacement: full width rows below the seeded widgets (bottom track 50);
    // the KPI added right after the refund tile shares its row and both are re-split to 12 + 12 columns.
    assert.deepEqual(added['plumbing-chart'].layout, { xTrack: 0, yTrack: 50, xSpan: 24, ySpan: 20 });
    assert.deepEqual(added['plumbing-week-tile'].layout, { xTrack: 0, yTrack: 70, xSpan: 12, ySpan: 12 });
    assert.deepEqual(added['plumbing-kpi'].layout, { xTrack: 12, yTrack: 70, xSpan: 12, ySpan: 12 });
    assert.deepEqual(added['plumbing-grid'].layout, { xTrack: 0, yTrack: 82, xSpan: 24, ySpan: 18 });
    assert.deepEqual(added['plumbing-daily'].layout, { xTrack: 0, yTrack: 100, xSpan: 24, ySpan: 20 });
    assert.deepEqual(added['plumbing-daily'].dataMapping?.categoryKey.map((c) => c.id), ['refunds.date::day']);
    assert.equal(await canvasWidgetCount(page), canvasBefore + 5);
    assert.equal(await canvasHasText(page, 'Plumbing check grid'), true);
    const tileText = await page.evaluate(() => [...document.querySelectorAll('#myStudio .tw-refund-rate')].map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()));
    assert.ok(tileText.some((t) => t.startsWith('This calendar week')), `calendar-week tile text: ${JSON.stringify(tileText)}`);
    const geometry = await canvasGeometry(page);
    for (const frame of geometry.frames) {
      assert.equal(frame.titleTruncated, false, `title cut off: ${frame.title}`);
      assert.equal(frame.gridOverflowX, false, `grid columns overflow: ${frame.title}`);
      assert.deepEqual(frame.truncatedCells, [], `cells cut off in ${frame.title}`);
    }
    for (const name of ['PayPal Revenue by Customer Segment (This Month)', 'Plumbing check grid']) {
      const frame = geometry.frames.find((f) => f.title === name);
      assert.ok(frame && frame.width >= geometry.canvasWidth - 24, `${name} should use the full canvas width (${frame?.width} of ${geometry.canvasWidth})`);
    }
    const hostHeight = await page.evaluate(() => document.getElementById('myStudio')!.getBoundingClientRect().height);
    assert.ok(hostHeight >= 100 * 16, `the Studio host grows with the canvas (${hostHeight}px for 100 tracks)`);
    const kinds = result.turnEvents.map((e) => `${e.kind}${e.name ? `:${e.name}` : ''}`).filter((k) => k.startsWith('TOOL_CALL_EMITTED') || k.startsWith('STUDIO_TOOL_RESULT'));
    assert.deepEqual(kinds.filter((k) => k.startsWith('TOOL_CALL_EMITTED')), ['place_widget', 'configure_column_chart_grouped', 'place_widget', 'configure_refund_rate_tile', 'place_widget', 'configure_value', 'place_widget', 'configure_grid', 'add_widget_filter', 'place_widget', 'configure_column_chart_stacked', 'add_widget_filter'].map((n) => `TOOL_CALL_EMITTED:${n}`));
    const studioResults = result.turnEvents.filter((e) => e.kind === 'STUDIO_TOOL_RESULT').map((e) => String(e.result));
    assert.equal(studioResults.length, 12);
    // Health once the 14-day filter is applied: no density/variance hints (the M3 one-bar driver chart had one).
    const dailyHealth = await page.evaluate(async () => (await (window as any).__moneyDesk.studioApi.getAiContext().health.widget('plumbing-daily')).issues.map((i: { code: string; description: string }) => `${i.code}: ${i.description}`));
    assert.equal(dailyHealth.some((i: string) => i.startsWith('data_mapping_complete')), false, `fields mapped: ${dailyHealth}`);
    // Studio's own density check counts the categories it plots: one per day with refunds in the 14-day filter, not one bar.
    const categories = Number(/category_density: (\d+) categories/.exec(dailyHealth.join('\n'))?.[1]);
    const ledgerDays = new Set((anomaly as unknown as { daily: Array<{ date: string; refunds: number }> }).daily.filter((d) => d.refunds > 0).map((d) => d.date)).size;
    assert.equal(categories, ledgerDays, `one column per refund day in the last 14 days: ${dailyHealth}`);
    assert.ok(categories >= 7, `the drill-down shows baseline and spike days: ${categories}`);
    assert.equal(studioResults.some((r) => /error|rejected/i.test(r)), false, `Studio tool results: ${studioResults.join(' || ')}`);
    assert.deepEqual(await page.evaluate(() => (window as any).__moneyDesk.errors), []);
  } finally {
    await browser.close();
    await studioBridge.close();
    await paypalRead.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

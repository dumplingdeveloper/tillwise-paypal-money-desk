import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startSimulator } from '../src/server.js';
import { STUDIO_AGENT_SYSTEM_MESSAGE, type SessionFactory } from '../src/studioBridge.js';
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
      results.push(await invoke('configure_grid', { op: 'patch', widgetId: 'plumbing-grid', value: { type: 'grid', dataMapping: { cols: [{ id: 'receivables.customer' }, { id: 'receivables.invoice_number' }, { id: 'receivables.status' }, { id: 'receivables.due_date' }, { id: 'receivables.days_overdue' }, { id: 'receivables.amount_due' }] }, format: title('Plumbing check grid') } }, 'fake-call-8'));
      // add_widget_filter still works on a widget (a relative date filter on the segment chart).
      results.push(await invoke('add_widget_filter', { op: 'append', widgetId: 'plumbing-chart', value: { field: { id: 'captures.date' }, model: { operator: 'inRelativeRange', value: { type: 'last', value: 30, unit: 'day', includeToday: true } } } }, 'fake-call-9'));
      // Refund drill-down shape: one column per day (date bucket field id ::day), stacked by reason, over the
      // recent_refunds table, which already holds exactly the last 14 ledger days (no filter step to forget).
      results.push(await invoke('place_widget', { widgetId: 'plumbing-daily', type: 'column-chart-stacked' }, 'fake-call-10'));
      results.push(await invoke('configure_column_chart_stacked', { op: 'patch', widgetId: 'plumbing-daily', value: { type: 'column-chart-stacked', dataMapping: { categoryKey: [{ id: 'recent_refunds.date::day' }], valueKey: [{ id: 'recent_refunds.amount', aggregation: 'sum' }], legendKey: [{ id: 'recent_refunds.reason' }] }, format: title('Refunds per day by reason · last 14 days') } }, 'fake-call-11'));
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
    assert.deepEqual(added['plumbing-grid'].dataMapping?.cols.map((c) => c.id), ['receivables.customer', 'receivables.invoice_number', 'receivables.status', 'receivables.due_date', 'receivables.days_overdue', 'receivables.amount_due']);
    // The receivables table Studio holds is exactly the MCP export's outstanding invoices: no DRAFT, PAID or €0 rows.
    const exported = (await paypalRead.callReadOnly('paypal_ledger_export', { days: 45 })).data as { invoices: Array<{ invoice_number: string; status: string; amount_due: number; outstanding: boolean }> };
    const receivables = await page.evaluate(() => (window as any).__moneyDesk.ledger.receivables as Array<{ invoice_number: string; status: string; amount_due: number }>);
    assert.deepEqual(receivables.map((r) => r.invoice_number), exported.invoices.filter((i) => i.outstanding).map((i) => i.invoice_number));
    assert.ok(receivables.length >= 1 && receivables.every((r) => r.amount_due > 0 && !['DRAFT', 'PAID'].includes(r.status)), JSON.stringify(receivables));
    assert.ok(exported.invoices.some((i) => !i.outstanding), 'the export still has DRAFT/PAID invoices that the receivables view leaves out');
    assert.match(promptsSeen[0], /- receivables \(Only the PayPal invoices with money still owed/);
    // A legendKey split gets Studio's chart legend (format.style.theme.common.legend); a single-series chart does not.
    assert.deepEqual((added['plumbing-daily'].format as any)?.style?.theme?.common?.legend, { enabled: true, position: 'bottom' });
    assert.equal((added['plumbing-daily'].format as any)?.title?.text, 'Refunds per day by reason · last 14 days', 'the legend patch keeps the title');
    assert.equal((added['plumbing-chart'].format as any)?.style?.theme?.common?.legend, undefined);
    assert.equal(added['plumbing-week-tile'].format?.window, 'calendar-week');
    // Placement comes from TillwiseLayout.planPlacement: full width rows below the seeded widgets (bottom track 50);
    // the KPI added right after the refund tile shares its row and both are re-split to 12 + 12 columns.
    assert.deepEqual(added['plumbing-chart'].layout, { xTrack: 0, yTrack: 50, xSpan: 24, ySpan: 20 });
    assert.deepEqual(added['plumbing-week-tile'].layout, { xTrack: 0, yTrack: 70, xSpan: 12, ySpan: 12 });
    assert.deepEqual(added['plumbing-kpi'].layout, { xTrack: 12, yTrack: 70, xSpan: 12, ySpan: 12 });
    assert.deepEqual(added['plumbing-grid'].layout, { xTrack: 0, yTrack: 82, xSpan: 24, ySpan: 18 });
    assert.deepEqual(added['plumbing-daily'].layout, { xTrack: 0, yTrack: 100, xSpan: 24, ySpan: 20 });
    assert.deepEqual(added['plumbing-daily'].dataMapping?.categoryKey.map((c) => c.id), ['recent_refunds.date::day']);
    // recent_refunds (what the drill-down charts) is exactly the 14 days of the tool's daily series, day by day in EUR.
    const daily = (anomaly as unknown as { daily: Array<{ date: string; refunded: number }> }).daily;
    const recent = await page.evaluate(() => ({ rows: (window as any).__moneyDesk.ledger.recent_refunds as Array<{ date: string; amount: number }>, window: (window as any).__moneyDesk.ledger.recent_window }));
    assert.equal(daily.length, 14);
    assert.deepEqual([recent.window.start, recent.window.end], [daily[0].date, daily.at(-1)!.date]);
    const cents = (n: number) => Math.round(n * 100);
    const perDay = new Map<string, number>();
    for (const r of recent.rows) perDay.set(r.date, (perDay.get(r.date) || 0) + cents(r.amount));
    assert.deepEqual(daily.map((d) => [d.date, perDay.get(d.date) || 0]), daily.map((d) => [d.date, cents(d.refunded)]));
    assert.ok(promptsSeen[0].includes(`- recent_refunds (The same rows as refunds, already limited to the last 14 ledger days: ${recent.window.label} (${daily[0].date} to ${daily.at(-1)!.date})`), 'the agent sees the exact 14-day dates');
    assert.match(STUDIO_AGENT_SYSTEM_MESSAGE, /use the recent_refunds table: it already holds exactly those 14 days/);
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
    assert.deepEqual(kinds.filter((k) => k.startsWith('TOOL_CALL_EMITTED')), ['place_widget', 'configure_column_chart_grouped', 'place_widget', 'configure_refund_rate_tile', 'place_widget', 'configure_value', 'place_widget', 'configure_grid', 'add_widget_filter', 'place_widget', 'configure_column_chart_stacked'].map((n) => `TOOL_CALL_EMITTED:${n}`));
    const studioResults = result.turnEvents.filter((e) => e.kind === 'STUDIO_TOOL_RESULT').map((e) => String(e.result));
    assert.equal(studioResults.length, 11);
    // Health of the 14-day drill-down: no missing-field issues (the M3 one-bar driver chart had a density hint).
    const dailyHealth = await page.evaluate(async () => (await (window as any).__moneyDesk.studioApi.getAiContext().health.widget('plumbing-daily')).issues.map((i: { code: string; description: string }) => `${i.code}: ${i.description}`));
    assert.equal(dailyHealth.some((i: string) => i.startsWith('data_mapping_complete')), false, `fields mapped: ${dailyHealth}`);
    // Studio's own density check counts the categories it plots: one per day with refunds in the 14 days, not one bar.
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

// Usage: (cd alexa-sim && npm run build) && node scripts/m2-old-studio-error-repro.mjs   (needs Chrome; uses port 4191)
// Reproduces the pre-M2-fix Studio config from 0037ffe (no AI harness) and prints what onErrorRaised really carries.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../alexa-sim/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const { startSimulator } = await import(new URL('../alexa-sim/dist/src/server.js', import.meta.url).href);
const { server, studioBridge, paypalRead } = await startSimulator('127.0.0.1', 4191, { studioSessionFactory: async () => ({}), skipRuntimeStart: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route('**/old-probe.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><div id="myStudio" style="height:700px"></div><script src="/vendor/ag-studio.js"></script><script>
window.__errs = [];
const rows = [{ id: 'txn-1001', kind: 'capture', customer: 'Aoife Retail', segment: 'Retail', amount: 39, currency: 'EUR', status: 'COMPLETED', orderId: 136, paypalObjectId: 'MOCKCAPTURE136', ageDays: 1, updatedAt: '2026-10-16T11:00:00.000Z' }];
class MoneyTileWidget { init(p) { this.gui = document.createElement('div'); this.gui.textContent = 'tile'; } refresh() { return true; } getGui() { return this.gui; } }
const a = window.agStudio;
a.createStudio(document.getElementById('myStudio'), {
  mode: 'edit',
  data: { sources: [{ id: 'paypal_money', data: rows }] },
  widgets: (wc = { menu: [] }) => a.createWidgets({ additionalTypes: [
    { id: 'refundRateTile', label: 'Refund Rate Tile', comp: () => new MoneyTileWidget(), form: (p) => p.createDefaults({ dataMappingItems: [] }), defaultSize: { width: 260, height: 160 }, options: { kind: 'refund' }, ai: { description: 'x' } },
    { id: 'unpaidInvoiceScoreboard', label: 'Who Still Owes', comp: () => new MoneyTileWidget(), form: (p) => p.createDefaults({ dataMappingItems: [] }), defaultSize: { width: 320, height: 160 }, options: { kind: 'unpaid' }, ai: { description: 'x' } },
    { id: 'disputeDeadlineCountdown', label: 'Dispute Deadline Countdown', comp: () => new MoneyTileWidget(), form: (p) => p.createDefaults({ dataMappingItems: [] }), defaultSize: { width: 320, height: 160 }, options: { kind: 'dispute' }, ai: { description: 'x' } } ],
    menu: [...(wc.menu || []), { label: 'Tillwise money widgets', widgetIds: ['refundRateTile', 'unpaidInvoiceScoreboard', 'disputeDeadlineCountdown'] }] }),
  initialState: { pages: [{ id: 'money', name: 'Money Desk', widgets: { refund: { type: 'refundRateTile' }, unpaid: { type: 'unpaidInvoiceScoreboard' }, dispute: { type: 'disputeDeadlineCountdown' } }, widgetLayout: { refund: { xTrack: 0, yTrack: 0, xSpan: 8, ySpan: 8 }, unpaid: { xTrack: 8, yTrack: 0, xSpan: 8, ySpan: 8 }, dispute: { xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 8 } } }], selectedPageId: 'money', panels: { filters: { collapsed: true }, data: { collapsed: false } } },
  onErrorRaised: (e) => window.__errs.push({ keys: Object.keys(e), errorType: e.errorType, fatal: e.fatal, errorDetails: e.errorDetails, oldHandlerWouldPrint: (e && e.error && e.error.message) || (e && e.message) || 'unknown' }),
});
</script></body></html>` }));
await page.goto('http://127.0.0.1:4191/old-probe.html');
await page.waitForTimeout(5000);
console.log(JSON.stringify(await page.evaluate(() => window.__errs), null, 1));
console.log('canvas frames', await page.evaluate(() => document.querySelectorAll('.ag-studio-layout-canvas .ag-studio-layout-widget').length));
await browser.close(); await studioBridge.close(); await paypalRead.close(); server.closeAllConnections(); server.close();

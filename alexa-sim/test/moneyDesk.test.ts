import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerToTables, loadMoneyDeskLedger, MONEY_DESK_SOURCES } from '../src/moneyDesk.js';
import { PayPalMcpReadClient, READ_ONLY_PAYPAL_TOOLS, isReadOnlyPayPalTool, type PayPalReadClient } from '../src/paypalMcp.js';

test('money desk rows come from the MCP paypal_ledger_export result, projected onto the Studio tables', async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client: PayPalReadClient = {
    async listReadOnlyTools() { return []; },
    async callReadOnly(name, args) {
      calls.push({ name, args });
      return { speech: 'export', data: { mode: 'mock', anchor_date: '2026-10-17', generated_at: 'now', currency: 'EUR', counts: { captures: 1 },
        captures: [{ capture_id: 'C1', order_id: 7, date: '2026-10-16', customer: 'A', segment: 'Retail', gross: 10, fee: 1, net: 9, status: 'COMPLETED', secret_extra: 'dropped' }],
        refunds: [], invoices: [{ invoice_id: 'I1', customer: 'B', amount_due: 5, overdue: true, outstanding: true }, { invoice_id: 'I2', customer: 'C', status: 'PAID', amount_due: 0, outstanding: false }, { invoice_id: 'I3', customer: 'D', status: 'DRAFT', amount_due: 0 }], disputes: [], tracking: [] } };
    },
    async close() {},
  };
  const { ledger, source } = await loadMoneyDeskLedger(client, 30);
  assert.deepEqual(calls, [{ name: 'paypal_ledger_export', args: { days: 30 } }]);
  assert.equal(source.via, 'mcp');
  assert.equal(ledger.mode, 'mock');
  assert.equal(ledger.captures.length, 1);
  assert.equal('secret_extra' in ledger.captures[0], false);
  assert.equal(ledger.captures[0].gross, 10);
  assert.equal(ledger.invoices[0].amount_due, 5);
  assert.equal(ledger.invoices[0].status, null, 'missing fields stay null, nothing is invented');
  // receivables = exported invoices whose MCP `outstanding` flag is true; a missing flag never counts as owed.
  assert.deepEqual(ledger.invoices.map((i) => i.outstanding), [true, false, null]);
  assert.deepEqual(ledger.receivables.map((r) => [r.customer, r.amount_due]), [['B', 5]]);
  assert.equal('invoice_id' in ledger.receivables[0], false);
  assert.deepEqual(MONEY_DESK_SOURCES.map((s) => s.id), ['captures', 'refunds', 'invoices', 'receivables', 'disputes', 'tracking']);
  assert.deepEqual(ledgerToTables({}).captures, []);
});

test('the MCP read client refuses money-moving tools before any network call', async () => {
  const client = new PayPalMcpReadClient({ url: 'http://127.0.0.1:9/never' });
  for (const tool of ['paypal_refund_apply', 'paypal_refund_preview', 'paypal_invoice_send_apply', 'woo_price_apply']) {
    assert.equal(isReadOnlyPayPalTool(tool), false);
    await assert.rejects(client.callReadOnly(tool), /Refused/);
  }
  assert.deepEqual([...READ_ONLY_PAYPAL_TOOLS].sort(), ['paypal_dispute_get', 'paypal_disputes_list', 'paypal_ledger_export', 'paypal_money_briefing', 'paypal_refund_anomaly']);
});
